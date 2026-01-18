import {AppVideoCodec} from '../app-state';

export const extensionForCodec = (codec: AppVideoCodec) => {
    switch (codec) {
        case 'avc': return 'mp4';
        case 'vp8':
        case 'vp9':
        case 'av1': return 'webm';
    }
};
