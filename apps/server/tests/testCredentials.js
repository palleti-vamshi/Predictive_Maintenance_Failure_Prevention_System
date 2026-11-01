import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

export const TEST_CREDS = {
  manager: {
    email: process.env.TEST_MANAGER_EMAIL || 'manager@pune.bharatdynamics.demo',
    password: process.env.DEMO_MANAGER_PASSWORD || 'Manager123!'
  },
  tech: {
    email: process.env.TEST_TECH_EMAIL || 'tech@pune.bharatdynamics.demo',
    password: process.env.DEMO_TECH_PASSWORD || 'Tech123!'
  },
  tech2: {
    email: process.env.TEST_TECH2_EMAIL || 'tech2@pune.bharatdynamics.demo',
    password: process.env.DEMO_TECH_PASSWORD || 'Tech123!'
  },
  tech3: {
    email: process.env.TEST_TECH3_EMAIL || 'tech3@pune.bharatdynamics.demo',
    password: process.env.DEMO_TECH_PASSWORD || 'Tech123!'
  },
  viewer: {
    email: process.env.TEST_VIEWER_EMAIL || 'viewer@pune.bharatdynamics.demo',
    password: process.env.DEMO_VIEWER_PASSWORD || 'Viewer123!'
  },
  chennaiManager: {
    email: process.env.TEST_CHENNAI_MANAGER_EMAIL || 'manager@chennai.bharatdynamics.demo',
    password: process.env.DEMO_MANAGER_PASSWORD || 'Manager123!'
  },
  chennaiTech: {
    email: process.env.TEST_CHENNAI_TECH_EMAIL || 'tech@chennai.bharatdynamics.demo',
    password: process.env.DEMO_TECH_PASSWORD || 'Tech123!'
  },
  hyderabadManager: {
    email: process.env.TEST_HYDERABAD_MANAGER_EMAIL || 'manager@hyderabad.bharatdynamics.demo',
    password: process.env.DEMO_MANAGER_PASSWORD || 'Manager123!'
  },
  hyderabadTech: {
    email: process.env.TEST_HYDERABAD_TECH_EMAIL || 'tech@hyderabad.bharatdynamics.demo',
    password: process.env.DEMO_TECH_PASSWORD || 'Tech123!'
  }
};
