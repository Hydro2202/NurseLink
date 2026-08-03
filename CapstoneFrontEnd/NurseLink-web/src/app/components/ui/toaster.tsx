import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        style: {
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
        },
        className: 'font-sans',
      }}
    />
  );
}
