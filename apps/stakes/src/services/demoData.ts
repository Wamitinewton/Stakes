import customers from '../../scripts/demo-data/customers.json';
import deals from '../../scripts/demo-data/deals.json';
import goals from '../../scripts/demo-data/goals.json';
import issues from '../../scripts/demo-data/issues.json';
import messages from '../../scripts/demo-data/messages.json';
import project from '../../scripts/demo-data/project.json';
import requests from '../../scripts/demo-data/requests.json';
import type { DemoData } from '../core/demo.js';

// The seed files are plain JSON so they are easy to read and edit; the calibration
// test checks their shape and the scores they produce.
export const DEMO_DATA = {
  project,
  customers,
  deals,
  issues,
  requests,
  messages,
  goals,
} as unknown as DemoData;
