import { render } from 'preact';
import { App } from './ui/App';
import { ProfileViewer } from './ui/components/ProfileViewer';
import { viewerMode } from './ui/store';
import { isProfileViewerPath } from './site';
import './styles/app.css';

viewerMode.value = isProfileViewerPath(location.pathname);
if (viewerMode.value) document.title = 'Universal Macropad Profile Viewer';
render(viewerMode.value ? <ProfileViewer /> : <App />, document.getElementById('app')!);
