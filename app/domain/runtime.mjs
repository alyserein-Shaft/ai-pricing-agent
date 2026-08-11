export const createRuntimeContext = () => {
  const date = new Date();
  return {
    epoch: date.getTime(),
    iso: date.toISOString(),
    localLabel: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date),
  };
};

export const sessionCalendar = (() => {
  const date = new Date();
  const today = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 3);
  return { today, threeDaysFromToday: date.toISOString().slice(0, 10) };
})();
