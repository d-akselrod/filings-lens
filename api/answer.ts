import { getDeps } from '../server/deps';
import { handleAnswer } from '../server/handlers';

export default { fetch: (req: Request) => handleAnswer(req, getDeps()) };
