import '@testing-library/jest-dom/vitest';

// jsdom has no layout, so scrollIntoView does not exist; the card calls it for a new question.
if (typeof Element.prototype.scrollIntoView !== 'function') {
	Element.prototype.scrollIntoView = () => {};
}
