import { getDeps } from '../server/deps.js';
import { handleAnswer } from '../server/handlers.js';

export default { fetch: (req: Request) => handleAnswer(req, getDeps()) };
