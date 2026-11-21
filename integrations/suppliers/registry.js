import { AwDropshipConnector } from './aw-dropship/connector.js';
import { SupplierError } from './connector.js';

/**
 * Connector registry. Only suppliers implemented in this repository can be
 * instantiated; unknown connector names fail loudly rather than silently
 * pretending to work.
 */
const CONNECTORS = {
  'aw-dropship': AwDropshipConnector
};

export const SUPPLIER_SLUGS = Object.keys(CONNECTORS);

export function createSupplierConnector(account) {
  if (!account?.connector) {
    throw new SupplierError('SUPPLIER_INVALID_ACCOUNT', 'Supplier account is missing a connector.', {
      status: 500,
      expose: false
    });
  }
  const Connector = CONNECTORS[account.connector];
  if (!Connector) {
    throw new SupplierError(
      'SUPPLIER_UNSUPPORTED',
      `No connector is registered for "${account.connector}".`,
      { status: 500, expose: false }
    );
  }
  return new Connector(account);
}
