// Centralized design tokens & helper utilities
export const colors = {
  brandPrimary: '#0d6efd',
  success: '#28a745',
  warning: '#ffc107',
  info: '#17a2b8',
  danger: '#dc3545',
  outlineBorder: '#ccc',
  text: '#222',
  subtleText: '#555',
  bgPanel: '#ffffff',
  bgMuted: '#f7f9ff',
};

export const colorByUse = {
  'mixed-use': '#FFD700', // gold
  'residential': '#87CEEB', // sky blue
  'commercial': '#FF6347', // tomato
};

export const font = {
  baseFamily: 'system-ui, sans-serif',
  sizeLabel: '0.75rem',
  sizeInput: '0.8rem',
  sizeHeading2: '1.2rem',
};

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
};

export const radius = 6;

export function buttonVariants(base){
  return {
    base,
    primary: { ...base, backgroundColor: colors.brandPrimary, color: '#fff' },
    success: { ...base, backgroundColor: colors.success, color: '#fff' },
    warning: { ...base, backgroundColor: colors.warning, color: '#000' },
    info: { ...base, backgroundColor: colors.info, color: '#fff' },
    muted: { ...base, backgroundColor: '#6c757d', color: '#fff' },
    danger: { ...base, backgroundColor: colors.danger, color: '#fff' },
    outline: { ...base, backgroundColor: '#ffffff', color: '#000', border: '1px solid #ccc' },
  };
}
