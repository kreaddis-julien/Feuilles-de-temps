import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { onUpdaterEvent, openExternal, type UpdateInfo } from '@/desktop';

const RELEASES_URL = 'https://github.com/kreaddis-julien/Feuilles-de-temps/releases/latest';

// Notify-only banner (the app ships as an unsigned .dmg, so there is no in-app
// install). The Electron main process pushes an 'update-available' event when a
// newer GitHub release exists; the banner opens the release page for a manual
// download. Dismissing a version stops it nagging until an even newer one ships.
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    onUpdaterEvent((type, data) => {
      if (type !== 'update-available' || !data?.version) return;
      if (localStorage.getItem('update-dismissed') === data.version) return;
      setUpdate(data);
    });
  }, []);

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem('update-dismissed', update.version);
    setUpdate(null);
  };

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-primary/10 border-b border-primary/20 text-sm">
      <span className="text-foreground">
        Mise à jour disponible :{' '}
        <span className="font-semibold">v{update.version}</span>
      </span>
      <Button
        size="sm"
        className="h-7 gap-1.5"
        onClick={() => openExternal(update.url || RELEASES_URL)}
      >
        <Download className="h-3.5 w-3.5" />
        Télécharger
      </Button>
      <button
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground"
        title="Ignorer cette version"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
