import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const METRIC_HELP = "The embedding model's vectors are normalized (length 1). On normalized vectors, cosine, Euclidean and dot product always put results in the same order — only the scores differ. Shorten the vectors with the Dimensions slider and turn off Re-normalize to see them diverge.";

export function MetricHelp() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="About distance metrics"
          className="grid size-5 place-items-center rounded-md text-faint outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64 leading-relaxed">{METRIC_HELP}</TooltipContent>
    </Tooltip>
  );
}
