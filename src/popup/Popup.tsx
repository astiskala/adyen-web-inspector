import { render } from 'preact';
import { Popup } from './PopupApp';
import './popup.css';

document.body.classList.add('popup-body');

const root = document.getElementById('root');
if (root) {
  render(<Popup />, root);
}
