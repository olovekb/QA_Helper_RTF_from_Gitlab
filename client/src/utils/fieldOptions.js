/** fieldOptions в key => [{value, label}] для react-select */
export const createToOptions = (fieldOptions) =>
  (key) => (fieldOptions?.[key] || []).map(o => ({ value: o.id, label: o.name }));
