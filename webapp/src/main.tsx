import { render } from 'preact';
import { App } from './ui/App';
import { ProfileViewer } from './ui/components/ProfileViewer';
import { viewerMode } from './ui/store';
import { isLiveViewPath } from './site';
import './styles/app.css';

viewerMode.value = isLiveViewPath(location.pathname);
if (viewerMode.value) document.title = 'Universal Macropad Live View';
render(viewerMode.value ? <ProfileViewer /> : <App />, document.getElementById('app')!);
