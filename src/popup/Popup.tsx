import { render } from 'preact';
import '../shared/base.css';
import { Popup } from './PopupApp.js';

document.body.classList.add('popup-body');

const root = document.querySelector('#root');
if (root) {
  render(<Popup />, root);
}
