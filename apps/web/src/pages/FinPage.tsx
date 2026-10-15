// SPDX-License-Identifier: GPL-3.0-or-later
import { lazy, Suspense } from 'react';
import { ClientOnly } from 'vite-react-ssg';
import { Seo } from '../seo/Seo';
import { UpdatePrompt } from '../UpdatePrompt';

// Like the board editor (EditorPage): canvas, store and kernel assume a browser, so
// the designer loads client-side only and /fin prerenders to a clean noindex shell.
const FinApp = lazy(() => import('../fin/FinApp').then((m) => ({ default: m.FinApp })));

export default function FinPage() {
  return (
    <>
      <Seo
        title="Fin designer"
        description="OpenShaper's fin designer — draw a Futures-tab surf fin's outline, foil and flex, and export it for CNC or 3D printing."
        path="/fin"
        noindex
      />
      <ClientOnly>
        {() => (
          <>
            <UpdatePrompt />
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading the fin designer…
                </div>
              }
            >
              <FinApp />
            </Suspense>
          </>
        )}
      </ClientOnly>
    </>
  );
}
