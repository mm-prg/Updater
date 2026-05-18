# Updater Plugin for FM-DX Webserver 

The **Updater** plugin is a management tool designed for the [FM-DX Webserver](https://github.com/NoobishSVK/fm-dx-webserver). 
It provides an interface to easily track new versions of the installed plugins, download them from the github repository and directly update the plugins or even install new plugins. 
You may also directly explore the plugin files stored on the server and modify them (useful for config files). 

<img width="826" height="378" alt="plugins list" src="https://github.com/user-attachments/assets/88d6ba0e-50e1-4ecf-aa46-64750b0aa457" />



<img width="1166" height="915" alt="setup page" src="https://github.com/user-attachments/assets/fd94a700-2957-430f-a645-ef47ff3fb4fa" />


## Features

- **Automated Version Checking**: Automatically scans GitHub to detect if newer versions of your installed plugins are available.
- **One-Click Updates**: Download and install the latest versions of plugins, including recursive updates for associated folders and subdirectories.
- **Plugin Discovery & Installation**: Add new plugins by simply providing a GitHub repository URL. The updater automatically identifies descriptor files and required folder structures.
- **Plugins Overview**: A sortable table showing all installed plugins, current versions, authors, and real-time status.
- **Source Code Viewer**: Inspect local plugin descriptor files directly from the web interface.
- **Update Check**: Remembers and displays the specific files that were modified or added during the last update process. 

## Installation

Follow these steps to install the plugin:

1. Copy the `Updater.js` descriptor file into the `/plugins` directory of your FM-DX-Webserver.
2. Copy the entire `Updater/` folder into the `/plugins` directory.
3. Restart the FM-DX-Webserver.
4. Log in to the administrator panel, enable the plugin in the Setup page, and save.
5. Restart the FM-DX-Webserver one more time

## Usage
<img width="269" height="69" alt="header button" src="https://github.com/user-attachments/assets/2936edd5-c194-4639-a9b6-9e46eed78eae" />


The plugin interface is **accessible only to administrators** and no icons will appear until you're logged as an administrator. 
You may access it in three ways:

1. **Setup Plugins Page**. Navigate to the setup section of your webserver. In the Plugins page, just down the FM-DX-Webserver Plugin list, you will find the **Installed Plugins List** table is integrated directly into the settings area.
2. **Header Icon**. If you are logged in as an administrator, an icon will appear in the plugin panel. Clicking it opens the plugin interface as a modal window over the main page.
3. **Plugin Line Icon**: If you are logged in as an administrator, an icon appears in the header, between the icons of the installed plugins

In the options menu, you may enable or disable the icons and the list in the setup page. 

### Main page
<img width="1166" height="915" alt="setup page" src="https://github.com/user-attachments/assets/a48a95af-c7ba-4adb-b542-e16540cf057b" />

The plugin checks the server and shows the **list of the installed plugins** and their version. If you provide the url of the github repository of the plugin (Edit), it will check if a new version is avaliable.

- **Update**: Highlighted in red when a newer version is available. Just click it to automatically download the new version and to save the new files in the plugins directory of the server.
- **Reinstall**: Allows you to download again all files for the current version. 
- **Edit**: Add or modify the GitHub repository URL. Clicking the verify button, checks the url and automatically detects the plugin descriptor file and the plugin directory 
- **Delete**: Removes the plugin's descriptor file and its associated data directory from the server.
- **Explore**: Open the file manager to browse the plugin's local directory, view source code, edit files, or delete them.

**IMPORTANT! AFTER UPDATING DON'T FORGET TO CLEAR THE BROWSER CACHE AND RESTART THE SERVER

### Adding a new plugin

1. Click the **Add new plugin** button in the top-right corner.
2. Paste the **GitHub Repository URL** (e.g., `https://github.com/mm-prg/FavStations`).
3. Click the 🔍 (**Verify**) button. The system will automatically:
   - Scan the repository for a valid descriptor file (containing `pluginConfig`).
   - Check both the root and the `/plugins` directory on GitHub.
   - Detect the recommended **Local Directory** based on the plugin's frontend path.
4. Click **Save & Install**. The updater will download the descriptor and recursively pull all required assets into the correct folders.

### Explore page
<img width="1052" height="884" alt="explore page" src="https://github.com/user-attachments/assets/8a949101-f545-4d97-8c82-30a7f9b1c673" />


Clicking on "Explore" opens the Explore page.
Select a file or a directoy from the dropdown menus on the left, to browse and check files store in the server directories **"\plugins"** and **"\plugins_configs"**

You may view the content of text files and even modify them (config files, etc). 

When you download a plugin via the Updater, in the sidebar will appear a list of the downloaded files and the skipped files. To avoid overfilling the server \plugins directory, no file outside the plugin directory is downloaded. If you want to get this files, just click on the repository link of the plugin, shown on the right. 

### Options Menu

Click the **Gear Icon** next to the version number to access advanced settings:
- **Visibility**: Toggle the presence of the Updater in the Plugin Panel, Header Bar, or the Setup Table.
- **Configuration Files**: Quick access to raw configuration files `plugins_data.json` (stores the data of each installed plugins) and `pl_data.json` (stores the url of some repository).

*Disclaimer: This plugin requires administrative privileges and an active internet connection to communicate with GitHub. The plugin is provided as is and without any garante. It is recommended to backup your `plugins/` directory before performing any change.*
