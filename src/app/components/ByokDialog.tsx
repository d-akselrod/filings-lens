import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useKeys } from '@/state/keys';

const MIN_KEY_LENGTH = 20;

export function ByokDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { byokKey, remember: remembered, setByok, clearByok } = useKeys();
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(remembered);
  const trimmed = key.trim();

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed.length < MIN_KEY_LENGTH) return;
    setByok(trimmed, remember);
    setKey('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use your own Gemini key</DialogTitle>
          <DialogDescription>
            Your key stays in this browser and is sent only to Google. We never see it. Get a free key at{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
              Google AI Studio
            </a>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="byok-key" className="text-sm font-medium">Gemini API key</label>
            <Input id="byok-key" type="password" autoComplete="off" spellCheck={false} value={key}
              placeholder={byokKey ? 'A key is saved — paste a new one to replace it' : 'AIza…'} onChange={e => setKey(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="byok-remember" checked={remember} onCheckedChange={v => setRemember(v === true)} />
            <label htmlFor="byok-remember" className="text-sm">Remember on this device</label>
          </div>
          <DialogFooter>
            {byokKey && (
              <Button type="button" variant="outline" onClick={() => { clearByok(); setKey(''); }}>Remove key</Button>
            )}
            <Button type="submit" disabled={trimmed.length < MIN_KEY_LENGTH}>Save key</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
