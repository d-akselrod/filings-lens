import { getDeps } from '../server/deps';
import { handleStatus } from '../server/handlers';

export default { fetch: (req: Request) => handleStatus(req, getDeps()) };
