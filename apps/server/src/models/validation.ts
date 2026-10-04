/** Validation patterns shared by the model layer. */

/** 'HH:mm' 24-hour clock, zero padded. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Calendar date without a time component (used for a change's occurrence date). */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
