declare module '*.module.css' {
  const styles: { [key: string]: string | undefined };
  export default styles;
}

// Plain stylesheets are imported for side effects only (e.g. `import './popup.css'`).
declare module '*.css';
