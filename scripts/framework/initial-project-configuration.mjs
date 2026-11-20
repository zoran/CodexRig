/** Owns new-project configuration creation; excluded from independent project tooling. */
import { parseProductConfiguration } from "../contracts/product-configuration.mjs";
import { serializeDeliveryConfiguration } from "../contracts/delivery-configuration.mjs";
import { serializeTenancyConfiguration } from "../contracts/tenancy-configuration.mjs";
import { serializeLocalizationConfiguration } from "../contracts/localization-configuration.mjs";

export function initialProductConfiguration(repositoryName) {
  const value = {
    schemaVersion: 1,
    identity: {
      displayName: null,
      organizationName: null,
      applicationIds: {},
    },
    brand: { assets: {}, theme: {} },
    public: { contacts: {}, domains: {}, social: {}, urls: {} },
  };
  if (!String(repositoryName).trim()) throw new Error("Generated project name must be non-empty.");
  const content = `${JSON.stringify(value, null, 2)}\n`;
  parseProductConfiguration(content);
  return content;
}

export function initialDeliveryConfiguration() {
  return serializeDeliveryConfiguration({ declaredTargets: [], detectedTargets: [] });
}

export function initialTenancyConfiguration() {
  return serializeTenancyConfiguration({ tenantContext: { trustedSources: [] } });
}

export function initialLocalizationConfiguration() {
  return serializeLocalizationConfiguration();
}
