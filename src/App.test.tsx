import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('application smoke test', () => {
  it('renders the home heading and development placeholder', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<h1>IMO DEPTH</h1>');
    expect(html).toContain('開発準備中');
  });
});
