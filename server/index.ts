import 'dotenv/config';
import { app } from './app.js';

const host = process.env.HOST?.trim() || '127.0.0.1';
const configuredPort = process.env.PORT?.trim() || '3001';
const port = Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const server = app.listen(port, host, () => {
  console.info(`Hireme server listening on http://${host}:${port}`);
});
server.on('error', () => {
  console.error('The Hireme server could not listen on the configured host and port. Check HOST/PORT and whether the port is already in use.');
  process.exitCode = 1;
});
