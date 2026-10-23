import { loadDotenv } from '../config/dotenv';

loadDotenv('.env.local');

void import('./bootstrap.js');
