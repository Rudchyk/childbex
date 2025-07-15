import { App } from 'dwv';

export interface useDropboxProps {
  divId?: string;
  layerId?: string;
  dropboxClassName?: string;
  borderClassName?: string;
  hoverClassName?: string;
}

export const useDropbox = (props?: useDropboxProps) => {
  const {
    divId = 'dropBox',
    layerId = 'layerGroup0',
    dropboxClassName = 'dropBox',
    borderClassName = 'dropBoxBorder',
    hoverClassName = 'hover',
  } = props || {};
  const showDropbox = (app: App, show: boolean) => {
    const defaultHandleDragEvent = (event: DragEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      defaultHandleDragEvent(event);
      if (event.dataTransfer) {
        app.loadFiles(event.dataTransfer.files);
      }
    };
    const onBoxDragOver = (event: DragEvent) => {
      defaultHandleDragEvent(event);
      // update box border
      const box = document.getElementById(divId);
      if (box && box.className.indexOf(hoverClassName) === -1) {
        box.className += ' ' + hoverClassName;
      }
    };
    const onBoxDragLeave = (event: DragEvent) => {
      defaultHandleDragEvent(event);
      // update box class
      const box = document.getElementById(divId);
      if (box && box.className.indexOf(hoverClassName) !== -1) {
        box.className = box.className.replace(' ' + hoverClassName, '');
      }
    };
    const box = document.getElementById(divId);
    if (!box) {
      return;
    }
    const layerDiv = document.getElementById(layerId);

    if (show) {
      // reset css class
      box.className = dropboxClassName + ' ' + borderClassName;
      // check content
      if (box.innerHTML === '') {
        const p = document.createElement('p');
        p.appendChild(document.createTextNode('Drag and drop data here or '));
        // input file
        const input = document.createElement('input');
        // TODO
        input.onchange = (event: any) => {
          if (event.target && event.target.files) {
            app.loadFiles(event.target.files);
          }
        };
        input.type = 'file';
        input.multiple = true;
        input.id = 'input-file';
        input.style.display = 'none';
        const label = document.createElement('label');
        label.htmlFor = 'input-file';
        const link = document.createElement('a');
        link.appendChild(document.createTextNode('click here'));
        link.id = 'input-file-link';
        label.appendChild(link);
        p.appendChild(input);
        p.appendChild(label);

        box.appendChild(p);
      }
      // show box
      box.setAttribute('style', 'display:initial');
      // stop layer listening
      if (layerDiv) {
        layerDiv.removeEventListener('dragover', defaultHandleDragEvent);
        layerDiv.removeEventListener('dragleave', defaultHandleDragEvent);
        layerDiv.removeEventListener('drop', onDrop);
      }
      // listen to box events
      box.addEventListener('dragover', onBoxDragOver);
      box.addEventListener('dragleave', onBoxDragLeave);
      box.addEventListener('drop', onDrop);
    } else {
      // remove border css class
      box.className = dropboxClassName;
      // remove content
      box.innerHTML = '';
      // hide box
      box.setAttribute('style', 'display:none');
      // stop box listening
      box.removeEventListener('dragover', onBoxDragOver);
      box.removeEventListener('dragleave', onBoxDragLeave);
      box.removeEventListener('drop', onDrop);
      // listen to layer events
      if (layerDiv) {
        layerDiv.addEventListener('dragover', defaultHandleDragEvent);
        layerDiv.addEventListener('dragleave', defaultHandleDragEvent);
        layerDiv.addEventListener('drop', onDrop);
      }
    }
  };
  const setupDropbox = (app: App) => {
    showDropbox(app, true);
  };

  return {
    setupDropbox,
    showDropbox,
  };
};
