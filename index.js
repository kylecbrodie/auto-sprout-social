const stripJsonComments = require("strip-json-comments")
const parse = require("csv-parse");
const dotenv = require("dotenv");
const moment = require("moment");
const path = require("path");
const fs = require("fs").promises;

const puppeteer = require("puppeteer-extra");
const puppeteerPluginStealth = require("puppeteer-extra-plugin-stealth")
puppeteer.use(puppeteerPluginStealth());

dotenv.config({ path: path.resolve(__dirname, "settings.txt") });

function randomTypingDelay() {
	return 10 + Math.random() * 5;
}

async function loadSelectors(relativeSelectorsFilePath) {
	const selectorsFilePath = path.resolve(__dirname, relativeSelectorsFilePath);
	const selectorsFile = await fs.readFile(selectorsFilePath, "utf-8")
	return JSON.parse(stripJsonComments(selectorsFile));
}

async function loadData(relativeCSVFilePath) {
	const data = [];
	const parser = parse();
	const heading_row = process.env.HEADING_ROW.toLowerCase().trim() === "true";
	let heading_skipped = false;
	parser.on("readable", () => {
		let record;
		while(record = parser.read()) {
			if(heading_row && !heading_skipped) {
				heading_skipped = true;
			}
			else {
				data.push(record);
			}
		}
	});
	parser.on("error", (err) => {
		console.error(err);
	});

	const csvFilePath = path.resolve(__dirname, relativeCSVFilePath);
	const csv = await fs.readFile(csvFilePath, "utf-8");
	parser.write(csv);
	parser.end();

	const objData = data.map((row) => {
		return {
			accountName: row[0],
			accountType: row[1],
			imagePath: row[2],
			caption: row[3],
			date: row[4],
			time: row[5]
		}
	});
	return objData;
}

async function init(uri) {
	// const headless = process.env.HEADLESS.toLowerCase().trim() === "true";
	const pathToUBlock = path.resolve(__dirname, "ublock");
	const pathToUBlockExtra = path.resolve(__dirname, "ublock-extra");
	const browser = await puppeteer.launch({
		dumpio: true,
		headless: false, // headless,
		defaultViewport: {
			width: 1440,
			height: 900
		},
		args: [
			`--disable-extensions-except=${pathToUBlock},${pathToUBlockExtra}`,
			`--load-extension=${pathToUBlock}`,
			`--load-extension=${pathToUBlockExtra}`,
		],
	});
	const context = browser.defaultBrowserContext();
	// await context.clearPermissionOverrides();
	// await context.overridePermissions(uri, ["clipboard-read"]);

	const page = await browser.newPage();
	await page.goto(uri, { waitUntil: 'networkidle2'})

	return { browser, page };
}

async function login(selectors, uri, username, password) {
	const { browser, page } = await init(uri);

	const usernameElement = await page.$(selectors.username);
	const passwordElement = await page.$(selectors.password);
	const loginElement = await page.$(selectors.login);

	await usernameElement.type(username, { delay: randomTypingDelay() });
	await passwordElement.type(password, { delay: randomTypingDelay() });

	await loginElement.click();
	await page.waitForNavigation();

	return { browser, page };
}

async function goToPublishingCalendar(selectors, page) {
	await page.waitForSelector(selectors.publishingLink);
	await Promise.all([
		page.waitForNavigation(),
		page.click(selectors.publishingLink)
	]);

	await page.waitForSelector(selectors.calendarLink);
	await page.click(selectors.publishingLink);
}

async function goToCompose(selectors, page) {
	await page.waitForSelector(selectors.composeButton);
	await page.click(selectors.composeButton);
}

async function toggleDraftSwitch(selectors, page) {
	//let draftSwitchState = await page.evaluate(
		//(sel) => document.querySelector(sel).attributes["data-qa-switch-state"].value,
		//selectors.draftSwitch
	//);
	const draftSwitch = await page.waitForSelector(selectors.draftSwitch);
	let draftSwitchState = await draftSwitch.evaluate((s, attr) => s.attributes[attr].value, selectors.draftSwitchStateAttribute);
	draftSwitchState = draftSwitchState.toLowerCase().trim();
	// if the switch is not in the desired on/off
	// position then click on it to change it to
	// the desired one. draft = "true" means turn
	// on draft mode if it isn't already and draft
	// = "false" means turn off draft mode if it
	// isn't already off.
	if(draftSwitchState !== process.env.DRAFT.toLowerCase().trim()) {
		await draftSwitch.click();
	}
}

async function removeExistingAccounts(selectors, page) {
	await page.waitForSelector(selectors.accountPickerButton);
	let existingAccountNames = await page.evaluate(
		(accPickButton) => document.querySelector(accPickButton)
							.innerText.split('\n'),
		selectors.accountPickerButton)
	while (existingAccountNames[0] !== "Please select a profile") {
		await toggleAccount(selectors, page, existingAccountNames[0], null, true);
		existingAccountNames = await page.evaluate(
			(accPickButton) => document.querySelector(accPickButton)
								.innerText.split('\n'),
			selectors.accountPickerButton)
	}
}

async function toggleAccount(selectors, page, accountName, accountType, checked) {
	await page.waitForSelector(selectors.accountPickerButton);
	const menuOpen = await page.evaluate(
		(selector) => document.querySelector(selector).classList.contains("is-open"),
		selectors.accountPickerButton
	)
	if(!menuOpen) {
		await page.click(selectors.accountPickerButton);
	}
	await page.waitForSelector(selectors.accountSearch);
	const accountSearch = await page.$(selectors.accountSearch);
	const accountSearchValue = await page.evaluate(
		(accountSearch) => accountSearch.value,
		accountSearch
	)
	if(accountSearchValue.length > 0) {
		await accountSearch.click({ clickCount: 3 });
	}

	// await paste(page, selectors.accountSearch, accountName.trim());

	let toType = accountName.trim();
	let checkboxes = [];
	do
	{
		await accountSearch.type(toType.substring(0, 3));//, { delay: randomTypingDelay() });
		toType = toType.substring(3);
		let sel = selectors.accountCheckbox;
		if(checked) {
			sel += ":checked"
		}
		else {
			sel += ":not(:checked)"
		}
		// await page.waitForSelector(sel);
		checkboxes = await page.$$(sel);
	} while(toType.length > 0 && (!checkboxes || checkboxes.length !== 1));

	for(const checkbox of checkboxes) {
		let shouldClick = false;
		if(accountType === null) {
			shouldClick = true;
		}
		else {
			const prevRowInnerText = await page.evaluate(
				(checkbox, sel) => {
					const row = checkbox.closest(sel);
					if(row && row.previousSibling && row.previousSibling.innerText) {
						const prevRow = row.previousSibling;
						return prevRow.innerText.toLowerCase().trim();
					}
					else {
						return "";
					}
				},
				checkbox,
				selectors.closestRow
			);
			if(prevRowInnerText === accountType.toLowerCase().trim()) {
				shouldClick = true;
			}
		}

		if(shouldClick) {
			await checkbox.click();
		}
	}
	await page.click(selectors.composeColumn);
}

async function addAccount(selectors, page, accountName, accountType) {
	await toggleAccount(selectors, page, accountName, accountType, false);
	await page.click(selectors.composeColumn);
}

async function addCaption(selectors, page, caption) {
	// await paste(page, selectors.captionTextbox, caption);
	await page.type(selectors.captionTextbox, caption);
}

async function addImage(selectors, page, imagePath) {
	const imageInput = await page.$(selectors.imageInput);
	const fullImagePath = path.resolve(__dirname, imagePath);
	await imageInput.uploadFile(fullImagePath);
	await page.waitForSelector(selectors.uploadedImage);
}

async function setScheduledTime(selectors, page, localDateString, local24hrTimeString) {
	await page.waitForSelector(selectors.todayTD);
	await page.click(selectors.todayTD);
	const datetime = `${localDateString} ${local24hrTimeString}`.toLowerCase().trim();
	const expectedFormats = ["YYYY-MM-DD h:mm:ss a", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm", "M/D/YYYY h:mm:ss a", "M/D/YYYY h:mm a", "M/D/YY h:mm:ss a", "M/D/YY h:mm a"];
	const scheduledTime = moment(datetime, expectedFormats).local().utc().unix()
	await page.evaluate(
		(sel, v) => {
			document.querySelector(sel).value = v;
		},
		selectors.dateInput,
		scheduledTime);
}

async function schedule(selectors, page) {
	await page.waitForSelector(selectors.scheduleButton);
	await page.click(selectors.scheduleButton);
	await page.waitForSelector(selectors.successDialog);
}

async function main() {
	// const oldClipboard = await clipboardy.read();
	const dataToSchedule = await loadData(process.env.DATA_PATH);
	const selectors = await loadSelectors(process.env.SELECTORS_PATH);

	const { browser, page } = await login(selectors, process.env.LOGIN_URI, process.env.USERNAME, process.env.PASSWORD);

	await goToPublishingCalendar(selectors, page);

	for(const data of dataToSchedule) {
		try
		{
			await goToCompose(selectors, page);
			await toggleDraftSwitch(selectors, page);
			await removeExistingAccounts(selectors, page);
			await addAccount(selectors, page, data.accountName, data.accountType);
			await addImage(selectors, page, data.imagePath);
			await addCaption(selectors, page, data.caption);
			await setScheduledTime(selectors, page, data.date, data.time);
			await schedule(selectors, page);
		}
		catch(e)
		{
			console.error("Exception occurred while processing ", data, ":\n", e);
		}
	}


	// await clipboardy.write(oldClipboard);
	await browser.close();
}

//async function paste(page, inputSelector, text, mustType = false) {
	//if(!text || text.length == 0) return;
	//let finalChar = '';
	//if(mustType) {
		//finalChar = text[text.length - 1];
		//text = text.substring(0, text.length - 1);
	//}
	//const [ignored, input] = await Promise.all([
		//clipboardy.write(text),
		//page.waitForSelector(inputSelector)]);

	//await input.focus();
	//await input.evaluate(async i => {
		//window.focus();
		//i.value = await navigator.clipboard.readText();
	//});
	//if(finalChar.length > 0) {
		//await input.type(finalChar);
	//}

	//await input.focus();
	//await page.evaluate(() => document.execCommand("paste", false, null));
	//await page.keyboard.down("Control");
	//await page.keyboard.press("V");
	//await page.keyboard.up("Control");

	//const input = await page.$(inputSelector);
	//await input.focus();

	//await page.evaluate((i) => navigator.clipboard.readText().then((clippy) => console.log(clippy), (err_msg) => console.log(err_msg)), input);
//}

main();

process.on("unhandledRejection", (reason, p) => console.error('Unhandled Rejection at:', p, 'reason:', reason));
