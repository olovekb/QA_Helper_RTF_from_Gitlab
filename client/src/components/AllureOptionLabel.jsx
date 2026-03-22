import React from 'react';

export const formatAllureOptionLabel = (opt, { context }) =>
{
  if (context === 'value') return opt.label.split('(')[0].trim();
  return (
    <div className="allure-option-container">
      <div className="allure-option">
        <span className="allure-option__name">{ opt.label }</span>
        <span className="allure-option__details">ID: { opt.value }</span>
      </div>
      { opt.linked && <span className="allure-option__linked">уже привязан</span> }
    </div>
  );
};
