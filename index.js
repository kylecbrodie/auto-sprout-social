const stripJsonComments = require("strip-json-comments")
const puppeteer = require('puppeteer');
const parse = require("csv-parse");
const dotenv = require('dotenv');
const moment = require("moment");
const path = require('path');
const fs = require("fs").promises

const randomTypingDelay = () => 10 + Math.random() * 5;

dotenv.config({ path: path.resolve(process.cwd(), "settings.txt") });

async function loadSelectors(selectorsJsonFilePath) {
	const json = await fs.readFile(selectorsJsonFilePath, "utf-8")
	return JSON.parse(stripJsonComments(json));
}

async function loadData(csvFilePath) {
	const data = [];
	const parser = parse()
	parser.on("readable", () => {
		let record;
		while(record = parser.read()) {
			if(record[4].trim().toLowerCase() !== "time") {
				data.push(record);
			}
		}
	});
	parser.on("error", (err) => {
		console.error(err);
	});

	const csv = await fs.readFile(csvFilePath, "utf-8");
	parser.write(csv);
	parser.end();

	const objData = data.map((row) => {
		return {
			accountNames: [row[0]],
			imagePath: row[1],
			caption: row[2],
			date: row[3],
			time: row[4],
		}
	});
	return objData;
}

async function init(uri) {
	const browser = await puppeteer.launch({
		dumpio: true,
		headless: true,
		defaultViewport: {
			width: 1440,
			height: 900
		}
	});

	const page = await browser.newPage();
	await page.goto(process.env.LOGIN_URI, { waitUntil: 'networkidle2'})

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

async function removeExistingAccounts(selectors, page) {
	await page.waitForSelector(selectors.accountPickerButton);
	let existingAccountNames = await page.evaluate(
		(accPickButton) => document.querySelector(accPickButton)
							.innerText.split('\n'),
		selectors.accountPickerButton)
	while (existingAccountNames[0] !== "Please select a profile") {
		await toggleAccount(selectors, page, existingAccountNames[0], true);
		existingAccountNames = await page.evaluate(
			(accPickButton) => document.querySelector(accPickButton)
								.innerText.split('\n'),
			selectors.accountPickerButton)
	}
}

async function toggleAccount(selectors, page, accountName, checked) {
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
	await accountSearch.type(accountName.trim(), { delay: randomTypingDelay() });
	let sel = selectors.accountCheckbox;
	if(checked) {
		sel += ":checked"
	}
	else {
		sel += ":not(:checked)"
	}
	await page.waitForSelector(sel);
	const checkboxes = await page.$$(sel);
	for(const checkbox of checkboxes) {
		await checkbox.click();
	}
	await page.click(selectors.composeColumn);
}

async function addAccounts(selectors, page, accountNames) {
	for(let accountName of accountNames) {
		await toggleAccount(selectors, page, accountName);
	}
	await page.click(selectors.composeColumn);
}

async function addCaption(selectors, page, caption) {
	await page.waitForSelector(selectors.captionTextbox);
	await page.type(selectors.captionTextbox, caption);
}

async function addImage(selectors, page, imagePath) {
	const imageInput = await page.$(selectors.imageInput);
	await imageInput.uploadFile(imagePath);
	await page.waitForSelector(selectors.uploadedImage);
}

async function setScheduledTime(selectors, page, localDateString, local24hrTimeString) {
	await page.waitForSelector(selectors.todayTD);
	await page.click(selectors.todayTD);
	const datetime = `${localDateString} ${local24hrTimeString}`;
	const scheduledTime = moment(datetime, "YYYY-MM-DD h:mm:ss A").local().utc().unix()
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
	const dataToSchedule = await loadData(process.env.DATA_PATH);
	const selectors = await loadSelectors(process.env.SELECTORS_PATH);

	const { browser, page } = await login(selectors, process.env.LOGIN_URI, process.env.USERNAME, process.env.PASSWORD);

	await goToPublishingCalendar(selectors, page);

	for(const data of dataToSchedule) {
		try
		{
			await goToCompose(selectors, page);
			await page.waitForSelector(selectors.draftSwitch);
			let draftSwitchState = await page.evaluate(
				(sel) => document.querySelector(sel).attributes["data-qa-switch-state"],
				selectors.draftSwitch
			);
			// NOTE: When this is equal to true
			// it turns off draft mode if it is enabled.
			// That is the production setting. For testing
			// change "true" to "false" and it will turn on
			// draft mode if it isn't enabled.
			if(draftSwitchState === "true") {
				await draftSwitch.click();
			}
			await removeExistingAccounts(selectors, page);
			await addAccounts(selectors, page, data.accountNames);
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


	await browser.close();
}

main();