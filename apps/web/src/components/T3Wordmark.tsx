import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="6 6 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M28.5 41.2L11.6 24.4A9 9 0 0 1 24.4 11.6L28.5 15.8M35.5 22.8L52.4 39.6A9 9 0 0 1 39.6 52.4L35.5 48.2M22.8 28.5L39.6 11.6A9 9 0 0 1 52.4 24.4L48.2 28.5M41.2 35.5L24.4 52.4A9 9 0 0 1 11.6 39.6L15.8 35.5"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
    </svg>
  );
}
