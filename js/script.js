window.onload = function load_title() {
    let path = window.location.pathname.split("/").pop()
    if (path === "about.html")
        document.getElementById("title").innerText="About me";
    else if (path === "category.html")
        document.getElementById("title").innerText="Category";
    else if (path === "index.html")
        document.getElementById("title").innerText="Home Page";
    else if (path === "copyright.html")
        document.getElementById("title").innerText="Copyright Page";
    else
        document.getElementById("title").innerText="Reading blog";
}

function show_table_category(){
    document.getElementById('category_header').style.backgroundColor = "black";
    document.getElementById('category_header').style.borderRadius = '10px';
}

function hide_table_category(){
    document.getElementById('category_header').style.backgroundColor = "#353535";
    document.getElementById('category_header').style.borderStyle = "none";
}