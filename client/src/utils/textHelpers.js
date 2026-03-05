/**
 * Склонение слова "задача"
 * @param {number} n - количество
 * @param {string} form - падеж, винительный ('accusative') или родительный ('genitive')
 */
export const tasksWord = (n, form = 'accusative') =>
  form === 'genitive'
    ? (n === 1 ? 'задачи' : 'задач')
    : (n === 1 ? 'задачу' : n >= 2 && n <= 3 ? 'задачи' : 'задач');
