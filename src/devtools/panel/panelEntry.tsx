import { render } from 'preact';
import '../../shared/base.css';
import { Panel } from './Panel';

document.body.classList.add('devtools-panel');

const root = document.getElementById('root');
if (root) {
  render(<Panel />, root);
}
