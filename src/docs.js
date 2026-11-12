import '@fontsource/barlow-condensed/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';
import { initWallet } from './wallet.js';

initWallet(document.querySelectorAll('[data-connect]'));
