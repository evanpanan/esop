export type VestingScheduleItem = {
  vestDate: Date;
  shares: number;
};

export function addMonths(date: Date, months: number) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) {
    d.setDate(0);
  }
  return d;
}

export function generateStandardFourYearOneYearCliffSchedule(input: {
  totalShares: number;
  grantDate: Date;
}) {
  const totalShares = Math.floor(input.totalShares);
  if (!Number.isFinite(totalShares) || totalShares <= 0) return [];

  const cliffShares = Math.round(totalShares * 0.25);
  const remaining = totalShares - cliffShares;
  const monthlyBase = Math.floor(remaining / 36);
  const remainder = remaining - monthlyBase * 36;

  const schedule: VestingScheduleItem[] = [];

  schedule.push({
    vestDate: addMonths(input.grantDate, 12),
    shares: cliffShares,
  });

  for (let i = 1; i <= 36; i += 1) {
    schedule.push({
      vestDate: addMonths(input.grantDate, 12 + i),
      shares: monthlyBase + (i === 36 ? remainder : 0),
    });
  }

  return schedule.filter((x) => x.shares > 0);
}

export function generateImmediateVestingSchedule(input: {
  totalShares: number;
  grantDate: Date;
}) {
  const totalShares = Math.floor(input.totalShares);
  if (!Number.isFinite(totalShares) || totalShares <= 0) return [];
  return [
    {
      vestDate: input.grantDate,
      shares: totalShares,
    },
  ] satisfies VestingScheduleItem[];
}

export function generateCustomInstallmentsVestingSchedule(input: {
  totalShares: number;
  grantDate: Date;
  totalVestingDurationMonths: number;
  vestingInstallments: number;
}) {
  const totalShares = Math.floor(input.totalShares);
  const totalVestingDurationMonths = Math.floor(Number(input.totalVestingDurationMonths));
  const vestingInstallments = Math.floor(Number(input.vestingInstallments));

  if (!Number.isFinite(totalShares) || totalShares <= 0) return [];
  if (!Number.isFinite(totalVestingDurationMonths) || totalVestingDurationMonths <= 0) return [];
  if (!Number.isFinite(vestingInstallments) || vestingInstallments <= 0) return [];
  if (totalVestingDurationMonths % vestingInstallments !== 0) return [];

  const intervalMonths = totalVestingDurationMonths / vestingInstallments;
  const baseShares = Math.floor(totalShares / vestingInstallments);
  const remainder = totalShares - baseShares * vestingInstallments;

  const schedule: VestingScheduleItem[] = [];
  for (let i = 1; i <= vestingInstallments; i += 1) {
    schedule.push({
      vestDate: addMonths(input.grantDate, intervalMonths * i),
      shares: baseShares + (i <= remainder ? 1 : 0),
    });
  }

  return schedule.filter((x) => x.shares > 0);
}
