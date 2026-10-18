import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/state/session';
import type { ModelChoice } from '../../core/gemini';
import { MODEL_LABEL } from './AnswerCard';

const OPTIONS: Record<ModelChoice, string> = { fast: 'Gemma 4 · 26B (fast)', deep: 'Gemma 4 · 31B (deep, slower)' };

export function ModelPicker() {
  const model = useSession(s => s.model);
  const setModel = useSession(s => s.setModel);
  return (
    <Select value={model} onValueChange={v => setModel(v as ModelChoice)}>
      <SelectTrigger size="sm" aria-label="Answer model" className="h-7 gap-1 rounded-full px-2.5 text-[11.5px] text-muted-foreground shadow-none">
        <SelectValue>{MODEL_LABEL[model]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {(Object.keys(OPTIONS) as ModelChoice[]).map(m => <SelectItem key={m} value={m} className="text-[12.5px]">{OPTIONS[m]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
