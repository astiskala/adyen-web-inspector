import { render } from 'preact';
import '../../shared/base.css';
import { Panel } from './Panel.js';

document.body.classList.add('devtools-panel');

const root = document.querySelector('#root');
if (root) {
  render(<Panel />, root);
}
