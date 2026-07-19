# Updater Plugin for FM-DX Webserver 

The **Updater** plugin is a management tool designed for the [FM-DX Webserver](https://github.com/NoobishSVK/fm-dx-webserver). 
It provides a web interface to easily track new versions of the installed plugins and update them, automatically downloading files from the GitHub repository and saving them in the web server. 
It can automatically install a new plugin, just providing the URL of its GitHub repository. 
You may also explore the plugin files stored on the server and directly check and modify them with the plugin editor (e.g. config files, etc). 
- The Discord plugin page is: https://discord.com/channels/1053804249651359765/1506667363859173468/1506667363859173468

<img width="826" height="378" alt="plugins list" src="https://github.com/user-attachments/assets/88d6ba0e-50e1-4ecf-aa46-64750b0aa457" />

## Version 2.1

- Automatic recognition of locally installed plugins has been improved. The plugin should automatically recognize most of the available plugins and therefore make the first installation easier.
Thanks to @Ian Kelly | Reading, G 🇬🇧 for his report!
If you find a plugin that isn't automatically recognized, please let me know and I'll add it to the database.

## Version 2.0
- Added a server terminal, working on both Linux amd Windows, which allows you to send commands directly to the server

## Features

- **Automated Version Checking**: Automatically scans GitHub to detect if newer versions of your installed plugins are available.
- **One-Click Updates**: Download and install the latest versions of plugins, including recursive updates for associated folders and subdirectories.
- **Plugin Discovery & Installation**: Add new plugins by simply providing a GitHub repository URL. The updater automatically identifies descriptor files and required folder structures.
- **Plugins Overview**: A sortable table showing all installed plugins, current versions, authors, and real-time status.
- **Source Code Viewer**: Inspect local plugin descriptor files directly from the web interface.
- **Update Check**: Remembers and displays the specific files that were modified or added during the last update process. 

## First installation

Follow these steps to install the plugin:

1. Copy the `Updater.js` descriptor file into the `/plugins` directory of your FM-DX-Webserver.
2. Copy the entire `Updater/` folder into the `/plugins` directory.
3. Restart the FM-DX-Webserver.
4. Log in to the administrator panel, enable the plugin in the Setup page, and save.
5. Restart the FM-DX-Webserver one more time.

## Automatic recognition of locally installed plugins

- After installation, simply click on one of the Updater icons to bring up the list of the installed plugins
- During the first installation, the plugin will try to automatically check which plugins are already installed and automatically check and derive the plugin's relative data (repository, installation directory, descriptor file).
- Please be patient. This operation, which is only performed during **the first installation**, **may take some time**.
- After the first installation, Updater will just have to search for plugin updates on Github and will do it faster, immediately showing which plugins need to be updated
- If you open the list while reading the plugins directory is still in progress, the list will not be visible yet. In this case, simply wait a bit and then refresh the browser page.
- If you find a plugin that isn't automatically recognized, **please let me know and I'll add it to the database**.

## Usage

The plugin interface is **accessible only to administrators** and nothing will appear until you're logged in as an administrator. 
You may access it in three ways:

<img width="3760" height="1745" alt="setup page" src="https://github.com/user-attachments/assets/608c376e-366e-4ca1-99a6-1d278b6c468c" />

**Settings - Plugins Page**. Navigate to the setup section of your webserver. In the Plugins page, at the bottom of the FM-DX-Webserver Plugin page, you will find the **Installed Plugins List**

<img width="269" height="69" alt="header button" src="https://github.com/user-attachments/assets/2936edd5-c194-4639-a9b6-9e46eed78eae" />

**Header Icon**. If you are logged in as an administrator, an icon will appear in the plugin panel. Clicking it opens the plugin interface as a modal window over the main page.

**Plugin Line Icon**: If you are logged in as an administrator, an icon appears in the header, between the icons of the installed plugins

In the options menu, you may enable or disable the icons and the list in the setup page. 

## Main page

The plugin checks the server and shows the **list of the installed plugins** and their version. 
To check if a new version of each plugin is available, you need to provide **the URL of the github repository** of each plugin (Edit). 
When started for the first time, it will try to automatically retrieve the URL of the repository, looking in the file repo_data.json. Click 'Edit' to add the URL of other plugins. 

- **Update**: Highlighted in red when a newer version is available. Just click it to automatically download the new version and to save the new files in the plugins directory of the server.
- **Reinstall**: Allows you to download again all files for the current version. 
- **Edit**: Add or modify the GitHub repository URL. Clicking the verify button checks the URL and automatically detects the plugin descriptor file and the plugin directory. 
- **Delete**: Removes the plugin's descriptor file and its associated data directory from the server.
- **Explore**: Open the file manager to browse the plugin's local directory, view source code, edit files, or delete them.

**AFTER UPDATING, DON'T FORGET TO CLEAR THE BROWSER CACHE AND RESTART THE SERVER!**

## Adding a new plugin

1. Click the **Add new plugin** button in the top-right corner.
2. Paste the **GitHub repository URL** (e.g., `https://github.com/mm-prg/FavStations`).
3. Click the 🔍 (**Verify**) button. The system will automatically:
   - Scan the repository for a valid descriptor file (containing `pluginConfig`).
   - Check both the root and the `/plugins` directory on GitHub.
   - Detect the recommended **Local Directory** based on the plugin's frontend path.
4. Click **Save & Install**. The updater will download the descriptor and recursively pull all required assets into the correct folders.

**AS USUAL, AFTER INSTALLING A NEW PLUGIN, YOU HAVE TO RESTART THE SERVER AND ENABLE IT IN THE SETUP MENU, THEN CLEAR THE BROWSER CACHE AND RESTART THE SERVER ONE MORE TIME!**

## Advanced Tools Menu
You may hide this menu (and the Explore button). Select "Advanced Mode" on/off from the Options menu

- **Fm-Dx-Webserver Configuration** Clicking here lets you directly check the Fm-Dx-Webserver Configuration file (config.json). You may also edit and save the file, to make any change you need
- **View Server Log** Here you may view the **server log** and read the server message, to see what's happening in your server. As you know, you may also view the **browser log**, from your browser DevTools (usually, press F12)
- **View Node.js cache** Fm-Dx-Webserver runs on Node.js, with its pros and cons. Node.js caches a lot of files, to speed things up. If you edit a file on the server, Node.js often continues to use the old version of the file it cached. That's why, when you update a plugin, you usually need to restart the server. Here you can see which files are in the cache of Node.js 
- **Plugins data**: Quick access to raw configuration files `plugins_data.json` (stores the data of each installed plugin) and `pl_data.json` (stores the url of some repository).

## Execute Terminal Commands
- This is a small terminal (bash/cmd), working on both Linux amd Windows, which allows you to send commands directly to the server
- The available commands obviously depend on the operating system of your server (Windows/Linux).
- On linux you can also use **"sudo" commands**
- So, you may even try to send a restart command to the pc (e.g. "sudo reboot", "shutdown -r -t 0", etc), and if your server is set to restart automatically, you can restart pc and server this way. This is not recommended, but it may work
- It is also possible to store the two most used commands and, if you want, also store the sudo password. 
- It's a very powerful feature, use it with caution!
- If you find it useful, please let me know on Discord

## Explore page
You may hide this button (and the Advanced Tools menu). Select "Advanced Mode" on/off from the Options menu

<img width="1001" height="884" alt="explore page" src="https://github.com/user-attachments/assets/f4fe85e4-57d2-4c3b-b24d-55255443ad66" />

Clicking on "Explore" opens the Explore page.
Select a file or a directory from the dropdown menus on the left, to browse and check files stored in the server directories **"\plugins"** and **"\plugins_configs"**

You may view the content of text files and even modify them. 


When you download a plugin via the Updater, a sidebar will appear with a list of the downloaded files and the skipped files. To avoid overfilling the server \plugins directory, no file outside the plugins directory is downloaded. If you want to view these files, just click on the repository link of the plugin, shown above. 

## Modifying a plugin parameters or configuration file

- Click on Explore, select the **"plugins_configs"** dropdown menu
- Click on the plugin config file (e.g. Updater.json, etc), that shows the content of the file
- Click on "Enable Editing", modify the file and save the changes
- If the plugin has no configuration file, but has **parameters** stored in the plugin.js file itself
- Look in the green box, click on the plugin file and edit it!


## Options Menu

Click the **Gear Icon** next to the version number to access advanced settings:
- **Visibility**: Toggle the presence of the Updater in the Plugin Panel, Header Bar, or the Setup Table.
- **Advanced Mode** Hide/Show the Advanced Tools Menu and the Explore button
- **Sudo Password** If you want, you may store the server password here


## Notes
- Comments and suggestions are welcome! Thanks to anyone who tries the plugin and reports any bugs.
- If you like the plugin, please tell me on Discord: https://discord.com/channels/1053804249651359765/1506667363859173468/1506667363859173468
- If you find a plugin that isn't automatically recognized, please let me know and I'll add it to the database.
- If the new version of a plugin has changed the names of the files or directories used or their position, it is recommended to delete it and then reload it as a new plugin. 
- The program uses the **Github API** (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2026-03-10), which has a limit of 60 requests per hour. 
The limit should be sufficient for all normal uses. If it is exceeded (error 403), you simply have to wait the necessary time. The number of available calls is indicated on the main page, at the top right. 

*Disclaimer: This plugin requires administrative privileges and an active internet connection to communicate with GitHub. The plugin is provided as is and without any guarantee. It is recommended to back up your data before performing any change.*
