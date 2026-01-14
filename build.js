#!/usr/bin/env node

import { promises } from "fs";
import hljs from "highlight.js";
import * as yaml from "js-yaml";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

// Code syntax highlighting
const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const markdown = "```python\nstart = dt.datetime(2024,10,2)\n```";

const html = marked.parse(markdown);
console.log(html);

const CONFIG = {
  EXCERPT_MAX_LENGTH: 300,
  HOME_POSTS_COUNT: 5,
  EXCERPT_SENTENCE_THRESHOLD: 0.6,
  OUTPUT_DIR: "docs",
  RSS_MAX_POSTS: 20,
};

function getSlugFromFile(filePath) {
  return filePath.split("/").pop().replace(".md", "");
}

function sanitizeRSSDescription(text) {
  return (
    text
      // Replace ampersands with 'and' (safest for RSS/CDATA)
      .replace(/&/g, "and")

      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function loadTemplates() {
  const templateFiles = [
    "head.html",
    "header.html",
    "footer.html",
    "index.html",
    "post.html",
    "archive.html",
    "about.html",
  ];

  try {
    const templates = {};
    for (const file of templateFiles) {
      const templateName = file.replace(".html", "");
      templates[templateName] = await promises.readFile(
        `src/templates/${file}`,
        "utf8",
      );
      console.log(`Loaded ${file} template`);
    }
    return templates;
  } catch (error) {
    console.error("Error loading templates:", error);
    process.exit(1);
  }
}

async function loadBlogData() {
  try {
    const yamlContent = await promises.readFile("src/content.yml", "utf8");
    const yamlData = yaml.load(yamlContent);

    // Process posts
    const posts = yamlData.posts.map((postRaw) => {
      const slug = postRaw.slug || getSlugFromFile(postRaw.filepath);

      return {
        title: postRaw.title,
        subtitle: postRaw.subtitle || "",
        date: new Date(postRaw.date),
        filepath: postRaw.filepath,
        path: `posts/${slug}`,
      };
    });

    // Sort posts by date (newest first)
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    const data = {
      title: yamlData.title,
      author: yamlData.author,
      description: `${yamlData.title} - ${yamlData.author}'s personal website`,
      url: yamlData.url,
      about: { filepath: yamlData.about.filepath },
      posts,
    };

    console.log(`Loaded ${posts.length} posts`);
    return data;
  } catch (error) {
    console.error("Error loading content.yml:", error);
    process.exit(1);
  }
}

async function loadContent(filepath) {
  try {
    return await promises.readFile(filepath, "utf8");
  } catch (error) {
    console.error(`Error loading ${filepath}:`, error);
    return null;
  }
}

function formatDate(dateString) {
  const options = { year: "numeric", month: "long", day: "numeric" };
  return new Date(dateString).toLocaleDateString("en-US", options);
}

function formatRSSDate(date) {
  return new Date(date).toUTCString();
}

function createExcerpt(content, maxLength = CONFIG.EXCERPT_MAX_LENGTH) {
  if (!content) return "No content available.";

  // Remove markdown formatting for excerpt
  let plainText = content
    .replace(/#{1,6}\s+/g, "") // Remove headers
    .replace(/\*\*(.*?)\*\*/g, "$1") // Remove bold
    .replace(/\*(.*?)\*/g, "$1") // Remove italic
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // Remove links, keep text
    .replace(/`(.*?)`/g, "$1") // Remove inline code
    .replace(/\n+/g, " ") // Replace newlines with spaces
    .trim();

  if (plainText.length <= maxLength) return plainText;

  // Find last complete sentence within limit
  const truncated = plainText.substring(0, maxLength);
  const lastSentence = truncated.lastIndexOf(".");

  if (lastSentence > maxLength * CONFIG.EXCERPT_SENTENCE_THRESHOLD) {
    return truncated.substring(0, lastSentence + 1);
  }

  // Fallback to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.substring(0, lastSpace) + "...";
}

function groupPostsByYear(posts) {
  const postsByYear = {};
  posts.forEach((post) => {
    const year = post.date.getFullYear();
    const month = post.date.toLocaleDateString("en-US", { month: "long" });

    if (!postsByYear[year]) {
      postsByYear[year] = {};
    }
    if (!postsByYear[year][month]) {
      postsByYear[year][month] = [];
    }
    postsByYear[year][month].push(post);
  });
  return postsByYear;
}

function generateNavigation(activeNav = null) {
  const navItems = [
    { path: "/", label: "Home", key: "home" },
    { path: "/archive/", label: "Archive", key: "archive" },
    { path: "/about/", label: "About", key: "about" },
  ];

  return navItems
    .map((item) => {
      const isActive = item.key === activeNav;
      const style = isActive ? "color: #3d362e; font-weight: 600;" : "";
      return `<li><a href="${item.path}" style="${style}">${item.label}</a></li>`;
    })
    .join("");
}

function generateFeaturedPost(post, postContent, isFirst = false) {
  const postExcerpt = createExcerpt(postContent);
  const cssClass = isFirst ? "first-post" : "subsequent-post";

  return `
    <article class="featured-post ${cssClass}">
      <div class="post-date">${formatDate(post.date)}</div>
      <h2 class="post-title">${post.title}</h2>
      <p class="post-subtitle">${post.subtitle}</p>
      <div class="post-excerpt">
        <p>${postExcerpt}</p>
      </div>
      <a href="/${post.path}/" class="read-more">Continue reading</a>
    </article>
  `;
}

function generatePostNavigation(post, posts) {
  const currentIndex = posts.findIndex((p) => p.path === post.path);
  let navHTML = '<div class="post-nav-container">';

  if (currentIndex > 0) {
    const prevPost = posts[currentIndex - 1];
    navHTML += `
      <div class="post-nav-left">
        <a href="/${prevPost.path}/" class="nav-button">Previous</a>
      </div>
    `;
  }

  if (currentIndex < posts.length - 1) {
    const nextPost = posts[currentIndex + 1];
    navHTML += `
      <div class="post-nav-right">
        <a href="/${nextPost.path}/" class="nav-button">Next</a>
      </div>
    `;
  }

  navHTML += "</div>";
  return navHTML;
}

function generateArchivePage(postsByYear) {
  let archiveHTML = "";
  const sortedYears = Object.keys(postsByYear).sort((a, b) => b - a);

  sortedYears.forEach((year) => {
    archiveHTML += `<div class="archive-year"><h2>${year}</h2>`;

    const months = Object.keys(postsByYear[year]);
    months.sort((a, b) => {
      const dateA = new Date(`${a} 1, ${year}`);
      const dateB = new Date(`${b} 1, ${year}`);
      return dateB - dateA;
    });

    months.forEach((month) => {
      const monthPosts = postsByYear[year][month];
      archiveHTML += `<div class="archive-month">`;

      monthPosts.forEach((post, index) => {
        const date = new Date(post.date);
        const day = date.getDate().toString().padStart(2, "0");
        const isFirstInMonth = index === 0;

        archiveHTML += `<div class="archive-entry">`;

        if (isFirstInMonth) {
          archiveHTML += `
            <h3 class="archive-month-header">${month}</h3>
            <div>
              <span class="archive-date">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
              <a href="/${post.path}/" class="archive-link">${post.title}</a>
            </div>
          `;
        } else {
          archiveHTML += `
            <div class="archive-month-spacer"></div>
            <span class="archive-date">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
            <a href="/${post.path}/" class="archive-link">${post.title}</a>
          `;
        }

        archiveHTML += "</div>";
      });

      archiveHTML += "</div>";
    });

    archiveHTML += "</div>";
  });

  return archiveHTML;
}

async function generateRSSFeed(data) {
  console.log("Generating RSS feed...");

  const postsForRSS = data.posts.slice(0, CONFIG.RSS_MAX_POSTS);
  let rssItems = "";

  for (const post of postsForRSS) {
    const content = await loadContent(post.filepath);
    const descriptionRaw = content
      ? createExcerpt(content, 500)
      : post.subtitle;
    const description = sanitizeRSSDescription(descriptionRaw);
    const postUrl = `${data.url}/${post.path}/`;

    rssItems += `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <description><![CDATA[${description}]]></description>
      <link>${postUrl}</link>
      <guid>${postUrl}</guid>
      <pubDate>${formatRSSDate(post.date)}</pubDate>
    </item>`;
  }

  const lastBuildDate = formatRSSDate(new Date());
  const mostRecentPostDate =
    data.posts.length > 0 ? formatRSSDate(data.posts[0].date) : lastBuildDate;
  const email = `noreply@${data.url.replace(/https?:\/\//, "").replace(/\/$/, "")}`;

  //   const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
  // <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  //   <channel>
  //     <title><![CDATA[${data.title}]]></title>
  //     <description><![CDATA[${data.description}]]></description>
  //     <link>${data.url}</link>
  //     <image>
  //       <url>${data.url}/assets/icons/rss-144x144.png</url>
  //       <title><![CDATA[${data.title}]]></title>
  //       <link>${data.url}</link>
  //       <width>144</width>
  //       <height>144</height>
  //     </image>
  //     <atom:link href="${data.url}/feed.xml" rel="self" type="application/rss+xml"/>
  //     <language>en-us</language>
  //     <managingEditor>${email} (${data.author})</managingEditor>
  //     <webMaster>${email} (${data.author})</webMaster>
  //     <lastBuildDate>${lastBuildDate}</lastBuildDate>
  //     <pubDate>${mostRecentPostDate}</pubDate>
  //     <ttl>60</ttl>${rssItems}
  //   </channel>
  // </rss>`;

  const rssXml = `<rss version="2.0">
<channel>
<title>BBC News</title>
<description>BBC News - Africa</description>
<link>https://www.bbc.co.uk/news/world/africa</link>
<image>
<url>
https://news.bbcimg.co.uk/nol/shared/img/bbc_news_120x60.gif
</url>
<title>BBC News</title>
<link>https://www.bbc.co.uk/news/world/africa</link>
</image>
<generator>RSS for Node</generator>
<lastBuildDate>Wed, 14 Jan 2026 20:48:13 GMT</lastBuildDate>
<atom:link href="https://feeds.bbci.co.uk/news/world/africa/rss.xml" rel="self" type="application/rss+xml"/>
<copyright>
Copyright: (C) British Broadcasting Corporation, see https://www.bbc.co.uk/usingthebbc/terms-of-use/#15metadataandrssfeeds for terms and conditions of reuse.
</copyright>
<language>en-gb</language>
<ttl>15</ttl>
<item>
<title>
Uganda election chief says he has had threats over results declaration
</title>
<description>
This follows comments by a presidential assistant that Bobi Wine would not be declared president, even if he wins.
</description>
<link>
https://www.bbc.com/news/articles/c62vd7542rno?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c62vd7542rno#0</guid>
<pubDate>Wed, 14 Jan 2026 18:18:46 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/a5ef/live/4b96a450-f140-11f0-bd56-9b1dc8f84e89.jpg"/>
</item>
<item>
<title>
'Welcome to 2976' - North Africa's Amazigh people ring in the new year
</title>
<description>
The Amazigh calendar places them almost a thousand years ahead of much of the rest of the world.
</description>
<link>
https://www.bbc.com/news/articles/cj0nm44g361o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cj0nm44g361o#0</guid>
<pubDate>Wed, 14 Jan 2026 00:37:02 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/32fe/live/3c269770-f099-11f0-b385-5f48925de19a.jpg"/>
</item>
<item>
<title>
Trump administration moves to end deportation protection for Somalis
</title>
<description>
As the US cracks down on illegal immigration in Minneapolis, home to a large Somali community, it will end protections for many in the country legally.
</description>
<link>
https://www.bbc.com/news/articles/cz0p9ld5egjo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cz0p9ld5egjo#0</guid>
<pubDate>Tue, 13 Jan 2026 16:43:36 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/8769/live/d7362a90-f095-11f0-95e0-85a8cfcc8ed7.jpg"/>
</item>
<item>
<title>Why Osimhen has become 'king of Nigerian football'</title>
<description>
Nigeria face a huge semi-final against Africa Cup of Nations hosts and favourites Morocco on Wednesday.
</description>
<link>
https://www.bbc.com/sport/football/articles/ce9yxjr98pgo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/ce9yxjr98pgo#0
</guid>
<pubDate>Wed, 14 Jan 2026 08:52:51 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/d644/live/d7b29840-f06e-11f0-a8a9-7f10ab32742b.jpg"/>
</item>
<item>
<title>
Operation against Nigerian kidnapping gang kills '200 bandits' - official tells BBC
</title>
<description>
The offensive is in the central state of Kogi, where the bandits have recently become more active.
</description>
<link>
https://www.bbc.com/news/articles/cevn0ezr0rgo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cevn0ezr0rgo#0</guid>
<pubDate>Tue, 13 Jan 2026 16:09:38 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/943a/live/77cad750-f099-11f0-b385-5f48925de19a.jpg"/>
</item>
<item>
<title>
Niger revokes licences of tanker drivers who refuse to go to Mali amid jihadist blockade
</title>
<description>
Jihadists have been targeting tankers entering Mali, worsening the country’s fuel shortage.
</description>
<link>
https://www.bbc.com/news/articles/cr578g7v082o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cr578g7v082o#0</guid>
<pubDate>Tue, 13 Jan 2026 10:24:30 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/e812/live/ece14990-f051-11f0-a7dd-01f56af872ef.jpg"/>
</item>
<item>
<title>
Will voters in one of the world's youngest countries give an 81-year-old another term?
</title>
<description>
Thursday's election highlights a demographic issue common to many African countries.
</description>
<link>
https://www.bbc.com/news/articles/c77k8pym06zo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c77k8pym06zo#1</guid>
<pubDate>Tue, 13 Jan 2026 00:22:34 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/2d4f/live/0f4e66c0-ef94-11f0-b5f7-49f0357294ff.jpg"/>
</item>
<item>
<title>
He once criticised African leaders who cling to power. Now he wants a seventh term
</title>
<description>
Yoweri Museveni, 81, says he has brought stability to Uganda. His critics complain of political oppression.
</description>
<link>
https://www.bbc.com/news/articles/cr7jep39eg4o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cr7jep39eg4o#1</guid>
<pubDate>Mon, 12 Jan 2026 10:43:00 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/b4c1/live/d7993380-ebf2-11f0-8608-ef259671aea9.jpg"/>
</item>
<item>
<title>
'Hounded and harassed': The former pop star taking on Uganda's long-time president
</title>
<description>
Bobi Wine - a former musician - has been arrested numerous times as he challenges President Yoweri Museveni.
</description>
<link>
https://www.bbc.com/news/articles/cz0pr807yz7o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cz0pr807yz7o#1</guid>
<pubDate>Mon, 12 Jan 2026 10:48:32 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/5ae1/live/8dcd1020-ea38-11f0-b5f7-49f0357294ff.jpg"/>
</item>
<item>
<title>
The musician and the strongman leader - what you need to know about Uganda's election
</title>
<description>
Voters could propel a leader into a fifth decade in power or back a change candidate.
</description>
<link>
https://www.bbc.com/news/articles/c205dd7gjrpo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c205dd7gjrpo#1</guid>
<pubDate>Fri, 09 Jan 2026 14:25:35 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/711d/live/839800c0-ed57-11f0-a422-4ba8a094a8fa.jpg"/>
</item>
<item>
<title>
South Africa's strained ties with US face new test - war games with China, Iran and Russia
</title>
<description>
The naval exercises could inflame relations with Donald Trump - who is already at loggerheads with Pretoria.
</description>
<link>
https://www.bbc.com/news/articles/c62wxezynk2o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c62wxezynk2o#2</guid>
<pubDate>Sat, 10 Jan 2026 00:05:41 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/651a/live/9b0c36d0-ed9e-11f0-b385-5f48925de19a.jpg"/>
</item>
<item>
<title>
The secret mission to fly ex-Somali president's body back home from Nigeria
</title>
<description>
An ex-air force pilot explains how he carried out an undercover mission to fly Siad Barre's body home for burial.
</description>
<link>
https://www.bbc.com/news/articles/c5y2v2p3nl8o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c5y2v2p3nl8o#2</guid>
<pubDate>Fri, 09 Jan 2026 00:17:11 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/45b0/live/e692e6a0-ec93-11f0-bed4-4bc64ed151a7.jpg"/>
</item>
<item>
<title>
Afcon quiz: Name every Africa Cup of Nations winner
</title>
<description>
With the Africa Cup of Nations kicking off on Sunday, 21 December, can you name every tournament winner?
</description>
<link>
https://www.bbc.com/sport/football/articles/c5yql3n8v5qo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/c5yql3n8v5qo#2
</guid>
<pubDate>Wed, 14 Jan 2026 09:15:40 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/c2af/live/dba94040-db59-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
Long wait for justice leaves South African families in limbo
</title>
<description>
With tens of thousands of cases waiting to be heard, some people have to wait four years for their trials to start.
</description>
<link>
https://www.bbc.com/news/articles/cx2drqwg32do?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cx2drqwg32do#3</guid>
<pubDate>Tue, 06 Jan 2026 00:02:46 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/8292/live/e2373430-ea4f-11f0-b385-5f48925de19a.jpg"/>
</item>
<item>
<title>
'You're invisible, you don't exist' - life without a birth certificate
</title>
<description>
Millions around the world are living in the shadows as stateless people as they lack official papers.
</description>
<link>
https://www.bbc.com/news/articles/cx2drqwp2eyo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cx2drqwp2eyo#3</guid>
<pubDate>Fri, 02 Jan 2026 02:15:28 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/b8d4/live/cb927110-df5d-11f0-a8dc-93c15fe68710.jpg"/>
</item>
<item>
<title>
Why Israel's recognition of Somaliland as an independent state is controversial
</title>
<description>
Somaliland wants international recognition - here's why, and what could have driven Israel to recognise it now.
</description>
<link>
https://www.bbc.com/news/articles/c14v4kmg275o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c14v4kmg275o#3</guid>
<pubDate>Tue, 30 Dec 2025 09:13:26 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/273f/live/6d4e4d90-e4e4-11f0-94b0-3564906c508d.jpg"/>
</item>
<item>
<title>
Coups, elections and protests - a difficult year for democracy in Africa
</title>
<description>
Post-election violence in Tanzania and more coups were part of a turbulent 12 months on the continent.
</description>
<link>
https://www.bbc.com/news/articles/c1lr70jg2zgo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c1lr70jg2zgo#3</guid>
<pubDate>Tue, 30 Dec 2025 00:39:04 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/edd7/live/05a0aed0-dcc5-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
Great white sharks being sold in North African fish markets, say researchers
</title>
<description>
Overfishing and illegal fishing are contributing to the loss of sharks, including great whites.
</description>
<link>
https://www.bbc.com/news/articles/c9qe9wvq534o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c9qe9wvq534o#3</guid>
<pubDate>Tue, 30 Dec 2025 01:15:19 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/8e3a/live/2d959090-df36-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
An orphan's brutal murder shines a spotlight on child abuse in Somalia
</title>
<description>
The woman who was supposed to care for Saabirin Saylaan was found to have beaten and tortured her.
</description>
<link>
https://www.bbc.com/news/articles/c0je281pnwyo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/c0je281pnwyo#3</guid>
<pubDate>Mon, 29 Dec 2025 03:22:26 GMT</pubDate>
<media:thumbnail width="240" height="143" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/5d55/live/df7ecca0-dcf6-11f0-aae2-2191c0e48a3b.png"/>
</item>
<item>
<title>Salah-Mane rivalry renewed in Afcon semi-finals</title>
<description>
Mohamed Salah's Egypt will face Senegal in the Afcon 2025 semi-finals, offering the chance of revenge against his old Liverpool team-mate Sadio Mane.
</description>
<link>
https://www.bbc.com/sport/football/articles/c9dvg5lyz02o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/c9dvg5lyz02o#4
</guid>
<pubDate>Tue, 13 Jan 2026 19:41:21 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/0536/live/ce2f7960-f090-11f0-b385-5f48925de19a.png"/>
</item>
<item>
<title>Adesanya set for return - but could it be the end?</title>
<description>
Former two-time middleweight champion Israel Adesanya returns to action for the first time in over a year when he faces Joe Pyfer in Seattle, Washington on 28 March.
</description>
<link>
https://www.bbc.com/sport/mixed-martial-arts/articles/c1kl8l33d77o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/mixed-martial-arts/articles/c1kl8l33d77o#4
</guid>
<pubDate>Wed, 14 Jan 2026 07:35:02 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/d3bc/live/1c559d00-f117-11f0-9423-a3ae5cf8d8a8.jpg"/>
</item>
<item>
<title>
Gabon's government lifts sanctions on team and Aubameyang
</title>
<description>
Gabon's government lifts the sanctions it imposed on the national team and striker Pierre-Emerick Aubameyang after their exit from Afcon 2025.
</description>
<link>
https://www.bbc.com/sport/football/articles/c07xdzdlg4mo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/c07xdzdlg4mo#4
</guid>
<pubDate>Tue, 13 Jan 2026 17:07:50 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/b1a9/live/166b7f70-f0a1-11f0-85ea-637af9691683.jpg"/>
</item>
<item>
<title>
Eritrea included in Afcon 2027 preliminary qualifying
</title>
<description>
Eritrea are included in the preliminary qualifying round draw for the 2027 Africa Cup of Nations despite being unranked by world governing body Fifa.
</description>
<link>
https://www.bbc.com/sport/football/articles/c4g0dx44nego?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/c4g0dx44nego#4
</guid>
<pubDate>Tue, 13 Jan 2026 14:27:19 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/3d19/live/4e5c7d50-f08b-11f0-92ac-9f1b3a47bd73.jpg"/>
</item>
<item>
<title>
Hearts insist Mato deal agreed despite Kansas sale claim
</title>
<description>
Sporting Kansas City concede defeat to Heart of Midlothian in their pursuit of Rogers Mato despite the Uganda forward's current club, Vardar, claiming they had accepted an £870,000 offer from the Major League Soccer club for the 22-year-old.
</description>
<link>
https://www.bbc.com/sport/football/articles/c17zwq0xj8xo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/c17zwq0xj8xo#4
</guid>
<pubDate>Wed, 14 Jan 2026 15:48:57 GMT</pubDate>
<media:thumbnail width="240" height="134" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/2ffd/live/84322a90-f09c-11f0-b5f7-49f0357294ff.jpg"/>
</item>
<item>
<title>All you need to know about Afcon 2025</title>
<description>
BBC Sport Africa provides all the information on the 2025 Africa Cup of Nations as the 35th edition of the continent's biggest sporting event reaches the semi-finals.
</description>
<link>
https://www.bbc.com/sport/football/articles/ce8gw6erjzlo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/articles/ce8gw6erjzlo#4
</guid>
<pubDate>Sat, 10 Jan 2026 22:21:33 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/841d/live/144d4950-d9b6-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
Algeria apologises after player mocks Congolese superfan dressed as pan-African hero
</title>
<description>
Michel Nkuka Mboladinga stood motionless throughout DR Congo's Afcon matches in tribute to Patrice Lumumba.
</description>
<link>
https://www.bbc.com/news/articles/cj0nqqgy77ro?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/articles/cj0nqqgy77ro#4</guid>
<pubDate>Thu, 08 Jan 2026 17:57:49 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/28d8/live/94bc1a00-ecb0-11f0-b5f7-49f0357294ff.jpg"/>
</item>
<item>
<title>
How radioactive rhino horns are helping with conservation
</title>
<description>
A project in South Africa is putting radioactive material in rhino horns to make it harder to smuggle them over borders.
</description>
<link>
https://www.bbc.com/news/videos/cgqe0yxg0zeo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/videos/cgqe0yxg0zeo#5</guid>
<pubDate>Fri, 09 Jan 2026 14:23:54 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/44fc/live/423cdc80-eb19-11f0-b5f7-49f0357294ff.jpg"/>
</item>
<item>
<title>
Sailors saved from going over edge of huge dam in South Africa
</title>
<description>
According to reports, the boat had suffered motor failure before drifting to the edge of the dam.
</description>
<link>
https://www.bbc.com/news/videos/cj6wew4958eo?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/videos/cj6wew4958eo#5</guid>
<pubDate>Fri, 02 Jan 2026 09:20:10 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/bda5/live/b1c7c660-e7b2-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
Watch: Stunning celestial events that lit up the skies in 2025
</title>
<description>
From meteor showers to supermoons, here are some of the sights that wowed stargazers this year.
</description>
<link>
https://www.bbc.com/news/videos/c8xdw7j2v2go?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/videos/c8xdw7j2v2go#5</guid>
<pubDate>Wed, 31 Dec 2025 15:33:33 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/9707/live/7ed3beb0-dd00-11f0-a8dc-93c15fe68710.jpg"/>
</item>
<item>
<title>The best players who never won Afcon?</title>
<description>
As two-time runner-up Mohamed Salah begins another tilt at the Africa Cup of Nations, BBC Sport Africa profiles top stars who never lifted the trophy.
</description>
<link>
</link>
<guid isPermaLink="false">
https://www.bbc.com/sport/football/videos/c1dz1d7r9vno#5
</guid>
<pubDate>Sat, 27 Dec 2025 09:04:48 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/84c2/live/9d6d0fe0-e019-11f0-b67b-690eb873de1b.jpg"/>
</item>
<item>
<title>
Ros Atkins on… The alleged links between the UAE and Sudan's civil war
</title>
<description>
BBC Analysis Editor Ros Atkins examines allegations of links between the UAE and Sudan’s RSF in the civil war, as international efforts continue to seek an end to the fighting.
</description>
<link>
https://www.bbc.com/news/videos/cly5p1vkm39o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/videos/cly5p1vkm39o#5</guid>
<pubDate>Fri, 19 Dec 2025 16:16:15 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/e06f/live/67365f80-dcea-11f0-aae2-2191c0e48a3b.png"/>
</item>
<item>
<title>
People in Benin felt 'total fear' at attempted coup
</title>
<description>
Residents of the main city express shock after soldiers tried to overthrow the president.
</description>
<link>
https://www.bbc.com/news/videos/c9qenv20lq5o?at_medium=RSS&at_campaign=rss
</link>
<guid isPermaLink="false">https://www.bbc.com/news/videos/c9qenv20lq5o#5</guid>
<pubDate>Mon, 08 Dec 2025 11:07:54 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/ca92/live/8d8641f0-d425-11f0-8c06-f5d460985095.jpg"/>
</item>
</channel>
</rss>`;

  return rssXml;
}

async function ensureDir(dirPath) {
  try {
    await promises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

function generateHead(template, data, asset_dir) {
  console.log("Generating head...");
  return template
    .replace(/\{\{TITLE\}\}/g, data.title)
    .replace(/\{\{SITE_TITLE\}\}/g, data.title)
    .replace(/\{\{ASSETS_DIR\}\}/g, asset_dir)
    .replace(/\{\{RSS_URL\}\}/g, "/feed.xml");
}

function generateHeader(template, data, activeNav = null) {
  console.log("Generating header...");

  const navHTML = generateNavigation(activeNav);
  const html = template
    .replace(/\{\{SITE_TITLE\}\}/g, data.title)
    .replace(/\{\{NAVIGATION\}\}/g, navHTML);

  return html;
}

function generateFooter(template, data) {
  console.log("Generating footer...");

  const html = template
    .replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getFullYear())
    .replace(/\{\{AUTHOR\}\}/g, data.author)
    .replace(/\{\{RSS_URL\}\}/g, "/feed.xml");

  return html;
}

async function buildHomePage(templates, data) {
  console.log("Building home page...");

  const postsToShow = data.posts.slice(0, CONFIG.HOME_POSTS_COUNT);
  let contentHTML = "";

  for (let i = 0; i < postsToShow.length; i++) {
    const post = postsToShow[i];
    const postContent = await loadContent(post.filepath);

    if (postContent) {
      contentHTML += generateFeaturedPost(post, postContent, i === 0);

      if (i < postsToShow.length - 1) {
        contentHTML += '<hr class="post-separator">';
      }
    }
  }
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "home");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.index
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, contentHTML)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(CONFIG.OUTPUT_DIR);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/index.html`, html);
  console.log("Built index.html");
}

async function buildPostPages(templates, data) {
  console.log("Building post pages...");

  const headHTML = generateHead(templates.head, data, "../../assets");
  const headerHTML = generateHeader(templates.header, data, null);
  const footerHTML = generateFooter(templates.footer, data);

  for (const post of data.posts) {
    const content = await loadContent(post.filepath);

    if (!content) {
      console.warn(`Could not load content for ${post.path}`);
      continue;
    }
    const postContentHTML = marked.parse(content);
    const postNavigationHTML = generatePostNavigation(post, data.posts);
    const postDate = formatDate(post.date);
    const postDir = `${CONFIG.OUTPUT_DIR}/${post.path}`;

    const html = templates.post
      .replace(/\{\{HEAD\}\}/g, headHTML)
      .replace(/\{\{HEADER\}\}/g, headerHTML)
      .replace(/\{\{POST_DATE\}\}/g, postDate)
      .replace(/\{\{POST_TITLE\}\}/g, post.title)
      .replace(/\{\{POST_SUBTITLE\}\}/g, post.subtitle)
      .replace(/\{\{POST_CONTENT\}\}/g, postContentHTML)
      .replace(/\{\{POST_NAVIGATION\}\}/g, postNavigationHTML)
      .replace(/\{\{FOOTER\}\}/g, footerHTML);

    await ensureDir(postDir);
    await promises.writeFile(`${postDir}/index.html`, html);
    console.log(`Built ${post.pathslug}/index.html`);
  }
}

async function buildAboutPage(templates, data) {
  console.log("Building about page...");

  const content = await loadContent(data.about.filepath);
  const aboutContent = content
    ? marked.parse(content)
    : "<p>About content could not be loaded.</p>";
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "about");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.about
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, aboutContent)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(`${CONFIG.OUTPUT_DIR}/about`);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/about/index.html`, html);
  console.log("Built about/index.html");
}

async function buildArchivePage(templates, data) {
  console.log("Building archive page...");

  const postsByYear = groupPostsByYear(data.posts);
  const archiveHTML = generateArchivePage(postsByYear);
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "archive");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.archive
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, archiveHTML)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(`${CONFIG.OUTPUT_DIR}/archive`);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/archive/index.html`, html);
  console.log("Built archive/index.html");
}

async function buildRSSFeed(data) {
  console.log("Building RSS feed...");

  const rssXml = await generateRSSFeed(data);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/feed.xml`, rssXml);
  console.log("Built feed.xml");
}

async function copyDirectory(src, dest) {
  await promises.access(src);
  await ensureDir(dest);
  const entries = await promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await promises.copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  console.log("Starting blog build...\n");

  try {
    await promises.rm(CONFIG.OUTPUT_DIR, { recursive: true, force: true });
    console.log(`Cleaned ${CONFIG.OUTPUT_DIR} directory`);
  } catch (error) {}

  // Load templates first
  const templates = await loadTemplates();
  const data = await loadBlogData();

  // Build all pages
  await buildHomePage(templates, data);
  await buildPostPages(templates, data);
  await buildAboutPage(templates, data);
  await buildArchivePage(templates, data);
  await buildRSSFeed(data);
  await copyDirectory("src/assets", `${CONFIG.OUTPUT_DIR}/assets`);
  await promises.copyFile("src/CNAME", `${CONFIG.OUTPUT_DIR}/CNAME`);
  await promises.copyFile("src/robots.txt", `${CONFIG.OUTPUT_DIR}/robots.txt`);

  console.log("Blog build completed successfully!");
  console.log(
    `Generated ${data.posts.length + 5} pages in ${CONFIG.OUTPUT_DIR}/`,
  );
}

if (process.argv[1] === __filename) {
  build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}
