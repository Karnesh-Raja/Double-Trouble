import { shipments } from '../database/repositories.js';
import { validateShipmentInput } from '../utils/validators.js';
import { AppError } from '../utils/errors.js';
import { config } from '../utils/config.js';

function nextId() {
  let n = shipments.count() + 1;
  while (shipments.findById(`SHP-${String(n).padStart(3, '0')}`)) n++;
  return `SHP-${String(n).padStart(3, '0')}`;
}

export function createShipment(body) {
  const v = validateShipmentInput(body);
  const id = v.id || nextId();
  if (shipments.findById(id)) throw new AppError(409, 'DUPLICATE_SHIPMENT', `Shipment ${id} already exists`);
  shipments.insert({ ...v, id, basePricePerKg: v.basePricePerKg ?? config.defaultBasePricePerKg });
  return shipments.findById(id);
}
