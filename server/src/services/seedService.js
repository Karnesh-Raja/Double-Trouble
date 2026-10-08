// Seeds the shared demo shipment (SHP-001) and its first NORMAL reading through the real pipeline.
import { shipments } from '../database/repositories.js';
import { createShipment } from './shipmentService.js';
import { runSimulation } from './simulationService.js';

export async function seedDemo() {
  if (shipments.findById('SHP-001')) return false;
  createShipment({ shipmentId: 'SHP-001', produceType: 'Tomatoes', origin: 'Chennai', destination: 'Bengaluru', baselineShelfLifeHours: 120, quantity: 1000 });
  await runSimulation('normal', 'SHP-001');
  return true;
}
