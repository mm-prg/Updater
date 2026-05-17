# Updater Plugin for FM-DX Webserver

The **Updater** plugin is a management tool designed for the [FM-DX Webserver](https://github.com/NoobishSVK/fm-dx-webserver). It provides a centralized interface to track, update, and install plugins directly from GitHub.

<img width="1876" height="961" alt="setup page" src="https://github.com/user-attachments/assets/c173a588-1217-4c53-a5bd-b8d927edb15a" />


## Features

- **Automated Version Checking**: Automatically scans GitHub to detect if newer versions of your installed plugins are available.
- **One-Click Updates**: Download and install the latest versions of plugins, including recursive updates for associated folders and subdirectories.
- **Cache Mismatch Detection**: Automatically detects if the browser is executing an old cached version of the plugin and prompts the user to perform a hard reload (Ctrl+F5).
- **Plugin Discovery & Installation**: Add new plugins by simply providing a GitHub repository URL. The updater automatically identifies descriptor files and required folder structures.
- **Inventory Overview**: A sortable table showing all installed plugins, current versions, authors, and real-time status.
- **Source Code Viewer**: Inspect local plugin descriptor files directly from the web interface.
- **Installation Path Verification**: View the full absolute path of installed plugins for easy debugging and manual configuration.
- **Update Tracking**: Remembers and displays the specific files that were modified or added during the last update process.
- **Custom Overrides**: Manually adjust GitHub repository links, file paths, or local directory mappings for any plugin.

## Installation

Follow these steps to install the plugin:

1. Copy the `Updater.js` descriptor file into the `/plugins` directory of your FM-DX-Webserver.
2. Copy the entire `Updater/` folder into the `/plugins` directory.
3. Restart the FM-DX-Webserver.
4. Log in to the administrator panel, enable the plugin in the Setup page, and save.


## Usage

The plugin interface is accessible to administrators in three ways, only accessible to administrators:

1. **Setup Page**: Navigate to the `/setup` section of your webserver. The **Plugin Inventory** table is integrated directly into the settings area.
2. **Main Interface**: If you are logged in as an administrator, a "cloud with downward arrow" icon appears in the plugin panel. Clicking it opens the inventory as a modal window over the main page.
3. **Plugin Line**: If you are logged in as an administrator, an icon appears in the header, between the icons of the installed plugins

You may enable or disable the inteface you like


### Plugins page

- **Update**: Highlighted in red when a newer version is available.
- **Reinstall**: Allows you to force-download all files for the current version if the installation is corrupted.
- **Edit**: Manually change the GitHub repository URL or the local target directory.
- **Delete**: Safely removes the plugin's descriptor file and its associated data directory from the server.
- **Explore**: Open the file manager to browse the plugin's local directory, view source code, edit files, or delete them.

### Add a new plugin

1. Click the **Add new plugin** button in the top-right corner.
2. Paste the **GitHub Repository URL** (e.g., `https://github.com/mm-prg/FavStations`).
3. Click the 🔍 (**Verify**) button. The system will automatically:
   - Scan the repository for a valid descriptor file (containing `pluginConfig`).
   - Check both the root and the `/plugins` directory on GitHub.
   - Detect the recommended **Local Directory** based on the plugin's frontend path.
4. Click **Save & Install**. The updater will download the descriptor and recursively pull all required assets into the correct folders.

### Options Menu

Click the **Gear Icon** next to the version number to access advanced settings:
- **Visibility**: Toggle the presence of the Updater in the Plugin Panel, Header Bar, or the Setup Table.
- **Files & Explorer**: Quick access to the "Browse Plugins Folder" tool or direct view of the raw configuration files (`new_data.json` and `pl_data.json`).
- **Maintenance**: **Merge New Data** allows you to consolidate manually added plugins or path overrides into the main database, keeping your configuration clean.

### Browse files

The **Folder Explorer** (accessible via the Options menu) allows you to navigate the server's `plugins/` directory:
- **Navigation**: Move through subdirectories and go back using the "Parent Directory" link.
- **Inspector**: Click on any text file (`.js`, `.json`, `.css`, `.md`, etc.) to open it in a syntax-highlighted, read-only viewer.
- **Update Verification**: After an update, the viewer highlights which files were modified, ensuring you can verify the changes immediately.

## Author

Developed by **mm-prg**.

---

*Disclaimer: This plugin requires administrative privileges and an active internet connection to communicate with GitHub.
The plugin is provided as is
 It is recommended to backup your `plugins/` directory before performing major updates.*