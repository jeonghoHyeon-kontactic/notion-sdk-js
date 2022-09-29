/* ================================================================================

	database-update-send-email.
  
  Glitch example: https://glitch.com/edit/#!/notion-database-email-update
  Find the official Notion API client @ https://github.com/makenotion/notion-sdk-js/

================================================================================ */

const express = require('express')
const app = express()
const port = 3000

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const sendgridMail = require("@sendgrid/mail")

console.log("노드")
console.log(process.env.SENDGRID_KEY)
console.log(process.env.NOTION_KEY)
console.log(process.env.NOTION_DATABASE_ID)
console.log(process.env.EMAIL_TO_FIELD)
console.log(process.env.EMAIL_FROM_FIELD)

dotenv.config()
sendgridMail.setApiKey(process.env.SENDGRID_KEY)
const notion = new Client({ auth: process.env.NOTION_KEY })

const databaseId = process.env.NOTION_DATABASE_ID

/**
 * Local map to store task pageId to its last status.
 * { [pageId: string]: string }
 */
const taskPageIdToStatusMap = {}

/**
 * Initialize local data store.
 * Then poll for changes every 5 seconds (5000 milliseconds).
 */
setInitialTaskPageIdToStatusMap().then(() => {
  setInterval(findAndSendEmailsForUpdatedTasks, 5000)
})

/**
 * Get and set the initial data store with tasks currently in the database.
 */
async function setInitialTaskPageIdToStatusMap() {
  const currentTasks = await getTasksFromNotionDatabase()
  for (const { pageId, status } of currentTasks) {
    taskPageIdToStatusMap[pageId] = status
  }
}

async function findAndSendEmailsForUpdatedTasks() {
  // Get the tasks currently in the database.
  console.log("\nFetching tasks from Notion DB...")
  const currentTasks = await getTasksFromNotionDatabase()

  // console.log(currentTasks)
  // console.log(currentTasks[0].status)

  // Return any tasks that have had their status updated.
  const updatedTasks = findUpdatedTasks(currentTasks)
  console.log(`Found ${updatedTasks.length} updated tasks.`)

  // For each updated task, update taskPageIdToStatusMap and send an email notification.
  for (const task of updatedTasks) {
    taskPageIdToStatusMap[task.pageId] = task.status
    if (task.status === "Done"){
      await sendUpdateEmailWithSendgrid(task)
    }else {
      console.log("업데이트")
    }
  }

}

/**
 * Gets tasks from the database.
 *
 * @returns {Promise<Array<{ pageId: string, status: string, title: string, checkbox : boolean }>>}
 */
async function getTasksFromNotionDatabase() {
  const pages = []
  let cursor = undefined

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    })
    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  console.log(`${pages.length} pages successfully fetched.`)

  const tasks = []
  for (const page of pages) {
    const pageId = page.id

    const statusPropertyId = page.properties["Status"].id
    const statusPropertyItem = await getPropertyValue({
      pageId,
      propertyId: statusPropertyId,
    })
    const status = statusPropertyItem.status
      ? statusPropertyItem.status.name
      : "No Status"

    const titlePropertyId = page.properties["Name"].id
    const titlePropertyItems = await getPropertyValue({
      pageId,
      propertyId: titlePropertyId,
    })
    const title = titlePropertyItems
      .map(propertyItem => propertyItem.title.plain_text)
      .join("")

    const checkboxPropertyId = page.properties["체크박스"].id
    const checkboxPropertyItem = await getPropertyValue({
      pageId,
      propertyId: checkboxPropertyId,
    })
    const checkbox = checkboxPropertyItem.checkbox

    const emailPropertyId = page.properties["이메일"].id
    const emailPropertyItem = await getPropertyValue({
      pageId,
      propertyId: emailPropertyId,
    })
    const email = emailPropertyItem.email
      
    tasks.push({ pageId, status, title, checkbox, email })
  }

  return tasks
}

/**
 * Compares task to most recent version of task stored in taskPageIdToStatusMap.
 * Returns any tasks that have a different status than their last version.
 *
 * @param {Array<{ pageId: string, status: string, title: string, checkbox : boolean }>} currentTasks
 * @returns {Array<{ pageId: string, status: string, title: string, checkbox : boolean  }>}
 */
function findUpdatedTasks(currentTasks) {
  return currentTasks.filter(currentTask => {
    const previousStatus = getPreviousTaskStatus(currentTask)
    
    return currentTask.status !== previousStatus
  })
}

/**
 * Sends task update notification using Sendgrid.
 *
 * @param {{ status: string, title: string }} task
 */
async function sendUpdateEmailWithSendgrid({ title, status, email }) {
  const message = `안녕하세요. ${title} 담당자님 컨택틱입니다. 
서비스 만족도 조사 부탁드립니다.
https://forms.gle/nTh8Pv4KPxGcU39h8`
  console.log(message)

  try {
    // Send an email about this change.
    await sendgridMail.send({
      to: email,
      from: process.env.EMAIL_FROM_FIELD,
      subject: "[컨택틱] 서비스 만족도 조사 부탁드립니다!",
      text: message,
    })
    console.log("Email Sent")
  } catch (error) {
    console.error(error)
  }
}

/**
 * Finds or creates task in local data store and returns its status.
 * @param {{ pageId: string; status: string }} task
 * @returns {string}
 */
function getPreviousTaskStatus({ pageId, status }) {
  // If this task hasn't been seen before, add to local pageId to status map.
  if (!taskPageIdToStatusMap[pageId]) {
    taskPageIdToStatusMap[pageId] = status
  }
  return taskPageIdToStatusMap[pageId]
}

/**
 * If property is paginated, returns an array of property items.
 *
 * Otherwise, it will return a single property item.
 *
 * @param {{ pageId: string, propertyId: string }}
 * @returns {Promise<PropertyItemObject | Array<PropertyItemObject>>}
 */
async function getPropertyValue({ pageId, propertyId }) {
  const propertyItem = await notion.pages.properties.retrieve({
    page_id: pageId,
    property_id: propertyId,
  })
  if (propertyItem.object === "property_item") {
    return propertyItem
  }

  // Property is paginated.
  let nextCursor = propertyItem.next_cursor
  const results = propertyItem.results

  while (nextCursor !== null) {
    const propertyItem = await notion.pages.properties.retrieve({
      page_id: pageId,
      property_id: propertyId,
      start_cursor: nextCursor,
    })

    nextCursor = propertyItem.next_cursor
    results.push(...propertyItem.results)
  }

  return results
}
