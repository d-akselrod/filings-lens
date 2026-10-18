import { getDeps } from '../server/deps.js';
import { handleEmbed } from '../server/handlers.js';

export default { fetch: (req: Request) => handleEmbed(req, getDeps()) };
