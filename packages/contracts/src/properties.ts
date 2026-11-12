// The two apps never share Forge storage. Jira issue entity properties are the only
// place both can read and write, so these keys are the whole cross-app channel.
export const SHIP_NOTICE_PROPERTY_KEY = 'stakes.shipNotice';
export const BRIDGE_CRM_PROPERTY_KEY = 'stakesBridge.crm';

// JQL cannot address a property key containing a dot, so the indexed copy of the
// ship notice is exposed under this alias.
export const SHIP_NOTICE_JQL_ALIAS = 'stakesShipNotice';
