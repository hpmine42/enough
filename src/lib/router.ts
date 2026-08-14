import { useEffect, useState } from 'react';

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState<string>(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
