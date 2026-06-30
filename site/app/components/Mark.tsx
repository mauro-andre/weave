// A marca do Weave: dois fios se entrelaçando — azul (relacional/SQL) e verde
// (objeto). O mesmo desenho do favicon, sem o quadrado de fundo (pra usar inline).
export const Mark = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7c5 0 7 10 16 10" stroke="#2F6FEB" strokeWidth={2.4} strokeLinecap="round" />
    <path d="M4 17c5 0 7-10 16-10" stroke="#10B981" strokeWidth={2.4} strokeLinecap="round" />
  </svg>
);
