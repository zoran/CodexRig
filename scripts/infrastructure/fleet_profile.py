"""Validate project-owned fleet profiles and observe their declared state on Linux targets."""

from datetime import date
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import sys
from urllib.parse import urlsplit


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate fleet profile field: {key!r}")
        result[key] = value
    return result


def literal(value):
    return (
        isinstance(value, str) and bool(value.strip()) and value == value.strip()
        and value.isprintable() and not re.search(r"\{[{%#]", value)
    )


def evidence(value):
    return (
        isinstance(value, str) and any(char.isalnum() for char in value)
        and value.strip().casefold() not in {"todo", "tbd", "n/a", "none", "unknown", "placeholder"}
        and "\0" not in value
    )


def source_url(value):
    if not literal(value) or any(char.isspace() for char in value) or "\\" in value:
        return False
    try:
        url = urlsplit(value)
        return (url.scheme == "https" and bool(url.hostname) and url.username is None
                and url.password is None and (url.port is None or url.port > 0))
    except ValueError:
        return False


def config_path(value):
    return (literal(value) and value.startswith("/") and not value.startswith("//")
            and value != "/" and posixpath.normpath(value) == value and "\\" not in value)


def load_fleet_profile(root, relative_path, declared_path):
    """Load version 1 and retain the original strings; free-form evidence stays on the controller."""
    if not literal(relative_path) or not relative_path.endswith(".json"):
        raise ValueError("A fleet profile must name a repository JSON file under infra/.")
    path = declared_path(root, relative_path)
    data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
    required = {"schemaVersion", "group", "distribution", "majorVersion", "converge", "workload",
                "tuningDecision", "validation", "reviewedOn", "sources", "sysctls"}
    if not isinstance(data, dict) or set(data) - {"packages", "files"} != required:
        raise ValueError("Fleet profile has missing or unknown fields.")
    if type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
        raise ValueError("Fleet profile requires schemaVersion 1.")
    if not literal(data["group"]) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", data["group"]):
        raise ValueError("Fleet group must name one Ansible inventory group.")
    for name in ("distribution", "majorVersion"):
        if not literal(data[name]):
            raise ValueError(f"Fleet {name} must be a nonempty literal fact string.")
    if not literal(data["converge"]) or not data["converge"].endswith((".yml", ".yaml")):
        raise ValueError("Fleet converge must name a project-owned Ansible task list under infra/.")
    declared_path(root, data["converge"])
    for name in ("workload", "tuningDecision", "validation"):
        if not evidence(data[name]):
            raise ValueError(f"Fleet {name} requires a workload-specific description.")
    reviewed = data["reviewedOn"]
    if not isinstance(reviewed, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", reviewed):
        raise ValueError("Fleet reviewedOn must be an ISO calendar date.")
    if date.fromisoformat(reviewed) > date.today():
        raise ValueError("Fleet reviewedOn cannot be in the future.")
    sources = data["sources"]
    if not isinstance(sources, list) or not sources or not all(map(source_url, sources)):
        raise ValueError("Fleet sources requires at least one HTTPS primary-source URL.")
    for name in ("sysctls", "packages", "files"):
        entries = data.get(name, {})
        if not isinstance(entries, dict):
            raise ValueError(f"Fleet {name} must be an object.")
        for key, value in entries.items():
            if name == "sysctls":
                valid = (re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+", key)
                         and isinstance(value, str) and literal(value.replace("\t", " ")))
            elif name == "packages":
                valid = (re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_:@-]*", key)
                         and isinstance(value, str)
                         and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_:~^%-]*", value))
            else:
                valid = (config_path(key) and isinstance(value, str)
                         and re.fullmatch(r"[a-f0-9]{64}", value))
            if not valid:
                raise ValueError(f"Invalid fleet {name} declaration for {key!r}.")
    return data


def package_version(record):
    version = record["version"]
    if not isinstance(version, str) or not version:
        raise ValueError("Installed package facts lack a version.")
    if record.get("source") == "rpm":
        release = record["release"]
        if not isinstance(release, str) or not release:
            raise ValueError("Installed RPM facts lack a release.")
        prefix = record.get("epoch")
        version = f"{version}-{release}"
        if prefix not in (None, "", "0", 0, "(none)"):
            version = f"{prefix}:{version}"
    return version


def file_digest(path):
    # Follow normal distro config links, but avoid reading a device or blocking on a FIFO.
    if not stat.S_ISREG(os.stat(path).st_mode):
        return None
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK), "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            return None
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
        return digest.hexdigest()


def host_drift(profile, distribution, major, records, sys_root=Path("/proc/sys")):
    drift = []
    if not isinstance(distribution, str) or not distribution or not isinstance(major, str) or not major:
        raise ValueError("Fresh Ansible distribution or major release facts are unavailable.")
    if not isinstance(records, dict):
        raise ValueError("Fresh Ansible package facts are unavailable.")
    if profile["sysctls"] and not sys_root.is_dir():
        raise ValueError("Cannot inspect the target Linux kernel settings under /proc/sys.")
    for name, fact in (("distribution", distribution), ("majorVersion", major)):
        if profile[name] != fact:
            drift.append(name)
    for key, expected in profile.get("packages", {}).items():
        installed = records.get(key, [])
        try:
            if not isinstance(installed, list):
                raise ValueError("Invalid installed package list.")
            versions = [package_version(item) for item in installed]
            if not versions or any(version != expected for version in versions):
                drift.append(f"package {key}")
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Cannot interpret installed package facts for {key}.") from error
    for kind, entries in (("sysctl", profile["sysctls"]), ("file", profile.get("files", {}))):
        for key, expected in entries.items():
            try:
                if kind == "file":
                    matches = file_digest(key) == expected
                else:
                    actual = sys_root.joinpath(*key.split(".")).read_text(encoding="utf-8")
                    matches = actual.split() == expected.split()
            except (FileNotFoundError, NotADirectoryError):
                matches = False
            except (OSError, UnicodeError) as error:
                detail = getattr(error, "strerror", None) or "invalid text"
                raise ValueError(f"Cannot read fleet {kind} {key}: {detail}.") from error
            if not matches:
                drift.append(f"{kind} {key}")
    return drift


if __name__ == "__main__":
    if sys.argv[1:] != ["--verify-host"]:
        sys.exit("Use the infrastructure administration entry point.")
    try:
        print(json.dumps(host_drift(**json.load(sys.stdin))))
    except (KeyError, TypeError, ValueError) as failure:
        sys.exit(str(failure))
