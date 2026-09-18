const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});

export function formatLiveRand(amount: number): string {
  return zar.format(amount).replace(/\u00a0/g, ' ');
}
