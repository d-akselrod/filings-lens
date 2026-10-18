import { getDeps } from '../server/deps';
import { handleEmbed } from '../server/handlers';

export default { fetch: (req: Request) => handleEmbed(req, getDeps()) };
