import { getDeps } from '../server/deps.js';
import { handleStatus } from '../server/handlers.js';

export default { fetch: (req: Request) => handleStatus(req, getDeps()) };
