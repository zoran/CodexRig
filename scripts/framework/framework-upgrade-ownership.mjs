/** Owns explicit framework-to-dependency lifecycle delegation for child upgrade refreshes. */
import { realpathSync } from "node:fs";
import process from "node:process";
import {
  adoptRuntimeLifecycleDelegation,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";

const delegationVariables = Object.freeze({
  operation: "CODEXRIG_LIFECYCLE_DELEGATION_OPERATION",
  role: "CODEXRIG_LIFECYCLE_DELEGATION_ROLE",
  root: "CODEXRIG_LIFECYCLE_DELEGATION_ROOT",
  token: "CODEXRIG_LIFECYCLE_DELEGATION_TOKEN",
});

export function claimDependencyRefresh(root) {
  const canonical = realpathSync.native(root);
  const delegatedRoot = process.env[delegationVariables.root]?.trim();
  const operation = process.env[delegationVariables.operation]?.trim();
  const role = process.env[delegationVariables.role]?.trim();
  const token = process.env[delegationVariables.token]?.trim();
  if (
    !delegatedRoot ||
    realpathSync.native(delegatedRoot) !== canonical ||
    operation !== "dependency" ||
    role !== "framework-dependency" ||
    !token
  ) {
    throw new Error("Framework dependency refresh requires its exact lifecycle delegation.");
  }
  const lifecycleCapability = adoptRuntimeLifecycleDelegation({
    root: canonical,
    operation,
    role,
    token,
  });
  let released = false;
  return Object.freeze({
    lifecycleCapability,
    release() {
      if (released) return;
      releaseRuntimeLifecycleLock({ root: canonical, owner: lifecycleCapability });
      released = true;
    },
  });
}
