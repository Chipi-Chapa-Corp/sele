# Visualization host

`visualize.css` and `visualize.html` are the utility styles, tooltips and tabs from
OpenAI's visualize skill 1.0.29. The upstream HTML's network library loaders are
removed; Sele bundles Lucide and Floating UI locally. `runtime.js` implements Sele's frame bridge
and local Tweak controls.

`sele-visualize://frame/` serves a fixed shell with its own CSP. Fragments arrive
via postMessage and execute only inside `sandbox="allow-scripts"`, without
same-origin, Electron preload, top-navigation or popup privileges. The app's CSP
continues to prohibit inline scripts. Network connections, nested frames, forms
and objects are blocked; static resources are limited to the skill's CDN list.

Only messages from managed iframe windows are accepted. Follow-ups from the active
frame require confirmation in the parent UI before they reach the conversation send
handler. Workspace identity uses normalized values, so refreshed chat metadata does
not reload the document. Reload rereads the original source, preserves local state
when the file is unchanged, and stages changed content in a second sandbox until
its scripts finish. The current frame stays visible if loading fails. Tweak controls
modify only the frame's state; annotation and submitting design changes are not
implemented.

Run `npm run test:visualization` on a desktop session to check the Electron frame
with the same parent CSP. `npm run test:chat-state` covers reference parsing.
